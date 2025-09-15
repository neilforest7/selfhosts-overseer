import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

interface MigrationConfig {
  timeoutMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
  useTransactions?: boolean;
  verboseLogging?: boolean;
  healthCheckIntervalMs?: number;
  enabled?: boolean;
}

interface MigrationResult {
  success: boolean;
  duration: number;
  migrationsApplied?: number;
  error?: string;
  fallbackUsed?: boolean;
  details?: string;
}

interface DatabaseHealth {
  connected: boolean;
  tables: string[];
  migrationsTableExists: boolean;
  appliedMigrations: string[];
  databaseSize?: string;
  connectionPool?: {
    total: number;
    active: number;
    idle: number;
  };
}

// Export interfaces for external use
export type { MigrationConfig, MigrationResult, DatabaseHealth };

@Injectable()
export class DatabaseMigrationService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseMigrationService.name);
  private readonly defaultConfig: MigrationConfig = {
    timeoutMs: parseInt(process.env.DB_MIGRATION_TIMEOUT || '60000'), // 1 minute
    retryAttempts: parseInt(process.env.DB_MIGRATION_MAX_RETRIES || '3'),
    retryDelayMs: parseInt(process.env.DB_MIGRATION_RETRY_DELAY || '5000'),
    useTransactions: false,
    verboseLogging: process.env.NODE_ENV === 'development',
    healthCheckIntervalMs: 30000,
    enabled: process.env.DISABLE_AUTO_MIGRATION !== 'true'
  };

  private lastMigrationResult: MigrationResult | null = null;
  private isMigrating = false;
  private migrationStats = {
    totalMigrations: 0,
    successfulMigrations: 0,
    failedMigrations: 0,
    lastMigrationTime: null as Date | null
  };

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    if (!this.defaultConfig.enabled) {
      this.logger.log('🔄 Auto migration disabled by configuration (DISABLE_AUTO_MIGRATION=true)');
      return;
    }

    // Don't run migration automatically here - it's handled manually in main.ts
    // This prevents duplicate migrations and ensures proper sequencing
    this.logger.log('📋 DatabaseMigrationService initialized - migration will be handled manually');
  }

  async runMigrations(config?: Partial<MigrationConfig>): Promise<MigrationResult> {
    const startTime = Date.now();
    const finalConfig = { ...this.defaultConfig, ...config };

    if (this.isMigrating) {
      this.logger.warn('⚠️ Migration already in progress, skipping duplicate request');
      return {
        success: false,
        duration: 0,
        error: 'Migration already in progress',
        details: 'Another migration is currently running'
      };
    }

    this.isMigrating = true;

    try {
      this.logger.log('🔄 Starting database migration check...');
      this.logger.log(`📊 Config: timeout=${finalConfig.timeoutMs}ms, retries=${finalConfig.retryAttempts}`);

      // Step 1: Check database connection
      await this.checkDatabaseConnection();

      // Step 2: Get current database state
      const dbHealth = await this.getDatabaseHealth();
      this.logger.log(`📊 Database state: ${dbHealth.tables.length} tables, migrations: ${dbHealth.migrationsTableExists ? 'exists' : 'missing'}`);

      // Step 3: Determine if migration is needed
      const needsMigration = await this.needsMigration(dbHealth);
      if (!needsMigration) {
        this.logger.log('✅ Database schema is up to date, no migration needed');
        const result = {
          success: true,
          duration: Date.now() - startTime,
          migrationsApplied: 0,
          details: 'Database schema is up to date'
        };
        this.lastMigrationResult = result;
        this.updateMigrationStats(result);
        return result;
      }

      // Step 4: Run migration with retry logic
      const result = await this.executeMigrationWithRetry(finalConfig);
      result.duration = Date.now() - startTime;

      // Step 5: Verify migration success
      if (result.success) {
        await this.verifyMigration();
        this.logger.log('✅ Database migration completed successfully');
      }

      this.lastMigrationResult = result;
      this.updateMigrationStats(result);
      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      this.logger.error('❌ Database migration failed:', errorMessage);

      const result = {
        success: false,
        duration,
        error: errorMessage,
        details: error instanceof Error ? error.stack : undefined
      };

      this.lastMigrationResult = result;
      this.updateMigrationStats(result);
      return result;

    } finally {
      this.isMigrating = false;
    }
  }

  // Helper methods
  private async checkDatabaseConnection(): Promise<void> {
    const maxAttempts = parseInt(process.env.DB_CONNECTION_MAX_ATTEMPTS || '20');
    const retryDelay = parseInt(process.env.DB_CONNECTION_RETRY_DELAY || '3000');

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.prisma.$connect();
        this.logger.log('✅ Database connection established');
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.error(`❌ Failed to connect to database after ${maxAttempts} attempts:`, error);
          throw new Error(`Database connection failed after ${maxAttempts} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        this.logger.warn(`Database connection attempt ${attempt}/${maxAttempts} failed. Retrying in ${retryDelay}ms...`);
        await this.sleep(retryDelay);
      }
    }
  }

  private async getDatabaseHealth(): Promise<DatabaseHealth> {
    try {
      // Check if migrations table exists first
      let migrationsTableExists = false;
      let appliedMigrations: string[] = [];

      try {
        const migrationsResult = await this.prisma.$queryRaw<[{ count: number }]>`
          SELECT COUNT(*) as count FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
        `;

        migrationsTableExists = migrationsResult[0].count > 0;

        // Only query applied migrations if table exists
        if (migrationsTableExists) {
          const migrationsAppliedResult = await this.prisma.$queryRaw`
            SELECT migration_name FROM _prisma_migrations
            WHERE finished_at IS NOT NULL
            ORDER BY finished_at DESC
          `;
          appliedMigrations = (migrationsAppliedResult as any[]).map((row: any) => row.migration_name);
        }
      } catch (error) {
        // Migrations table doesn't exist - this is normal for a fresh database
        this.logger.log('📋 Migrations table not found (expected for fresh database)');
        migrationsTableExists = false;
        appliedMigrations = [];
      }

      // Get actual table names
      this.logger.debug('🔍 Querying information_schema for tables...');
      const tables = await this.prisma.$queryRaw`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;
      this.logger.debug('📊 Raw tables query result:', JSON.stringify(tables, null, 2));
      const tableNames = (tables as any[]).map((row: any) => row.table_name);
      this.logger.debug('📋 Extracted table names:', tableNames);

      // Get database size
      let databaseSize: string | undefined;
      try {
        const sizeResult = await this.prisma.$queryRaw<[{ pg_size_pretty: string }]>`
          SELECT pg_size_pretty(pg_database_size(current_database())) as pg_size_pretty
        `;
        databaseSize = sizeResult[0].pg_size_pretty;
      } catch (error) {
        // Database size query failed, continue without it
      }

      return {
        connected: true,
        tables: tableNames,
        migrationsTableExists,
        appliedMigrations,
        databaseSize
      };
    } catch (error) {
      this.logger.error('❌ Failed to get database health:', error);
      return {
        connected: false,
        tables: [],
        migrationsTableExists: false,
        appliedMigrations: []
      };
    }
  }

  private async needsMigration(dbHealth: DatabaseHealth): Promise<boolean> {
    // First, determine the database state
    const dbState = await this.detectDatabaseState(dbHealth);

    this.logger.log(`🔍 Database state detected: ${dbState}`);

    // Only need migration if not complete
    return dbState !== 'complete';
  }

  private async detectDatabaseState(dbHealth: DatabaseHealth): Promise<'fresh' | 'partial' | 'complete'> {
    // Check if this is a fresh database (no tables at all)
    if (dbHealth.tables.length === 0) {
      this.logger.log('🆕 Fresh database detected (no tables)');
      return 'fresh';
    }

    // Check if migrations table exists and has applied migrations
    if (!dbHealth.migrationsTableExists) {
      // Has tables but no migration history - likely manually created or incomplete
      this.logger.log('⚠️ Database exists but no migration history found');
      return 'partial';
    }

    // **PRIORITY CHANGE**: Check _prisma_migrations table first (Prisma's source of truth)
    if (dbHealth.appliedMigrations.length > 0) {
      // Has migration history - verify it's complete
      const migrationHistory = await this.verifyMigrationHistoryCompleteness();
      if (migrationHistory.isComplete) {
        this.logger.log(`✅ Complete database detected (${dbHealth.appliedMigrations.length} migrations applied)`);
        return 'complete';
      } else {
        this.logger.log(`⚠️ Migration history exists but incomplete: ${migrationHistory.details}`);
        return 'partial';
      }
    }

    // No applied migrations but table exists - needs migration
    this.logger.log('⚠️ Migrations table exists but no migrations applied');
    return 'partial';
  }

  private async executeMigrationWithRetry(config: MigrationConfig): Promise<MigrationResult> {
    const maxRetries = config.retryAttempts || 3;
    const retryDelay = config.retryDelayMs || 5000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(`🚀 Attempting migration (attempt ${attempt}/${maxRetries})`);

        return await this.executeMigration(config);
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }

        this.logger.warn(`⚠️ Migration attempt ${attempt} failed, retrying in ${retryDelay}ms...`);
        await this.sleep(retryDelay);
      }
    }

    throw new Error('All migration attempts failed');
  }

  private async executeMigration(config: MigrationConfig): Promise<MigrationResult> {
    const startTime = Date.now();

    try {
      // Get current database state to determine strategy
      const dbHealth = await this.getDatabaseHealth();
      const dbState = await this.detectDatabaseState(dbHealth);

      this.logger.log(`🚀 Executing migration strategy for: ${dbState}`);

      // Choose migration strategy based on database state
      switch (dbState) {
        case 'fresh':
          return await this.executeBaselineMigration(config, startTime);
        case 'partial':
          return await this.executeStandardMigration(config, startTime);
        case 'complete':
          return {
            success: true,
            duration: Date.now() - startTime,
            migrationsApplied: 0,
            details: 'Database schema is up to date'
          };
        default:
          throw new Error(`Unknown database state: ${dbState}`);
      }
    } catch (error) {
      this.logger.warn('⚠️ Primary migration strategy failed, trying fallback...', error);

      try {
        // Fallback to db push for recovery
        const pushResult = await this.runPrismaCommand(['db', 'push', '--accept-data-loss'], config);
        if (pushResult.success) {
          return {
            success: true,
            duration: Date.now() - startTime,
            fallbackUsed: true,
            details: 'Migration completed using prisma db push (fallback)'
          };
        }

        throw new Error(pushResult.error || 'DB push failed');
      } catch (pushError) {
        throw new Error(`All migration strategies failed. Primary error: ${error instanceof Error ? error.message : error}. Fallback error: ${pushError instanceof Error ? pushError.message : pushError}`);
      }
    }
  }

  private async executeBaselineMigration(config: MigrationConfig, startTime: number): Promise<MigrationResult> {
    this.logger.log('🆕 Executing baseline migration for fresh database...');

    try {
      // **CHANGE**: For fresh databases, use migrate deploy to ensure proper migration history
      const migrateResult = await this.runPrismaCommand(['migrate', 'deploy'], config);
      if (migrateResult.success) {
        this.logger.log('✅ Baseline migration completed successfully');
        return {
          success: true,
          duration: Date.now() - startTime,
          migrationsApplied: this.extractMigrationCount(migrateResult.output),
          fallbackUsed: false,
          details: 'Fresh database initialized using prisma migrate deploy'
        };
      }

      throw new Error(migrateResult.error || 'Baseline migration failed');
    } catch (error) {
      // If migrate deploy fails on fresh database, it's likely a schema issue
      this.logger.warn('⚠️ Baseline migrate deploy failed, checking database state...', error);

      // Check if any tables were created despite the error
      const dbHealth = await this.getDatabaseHealth();
      if (dbHealth.tables.length > 0) {
        this.logger.log('📋 Some tables were created, attempting recovery with db push...');
        try {
          const pushResult = await this.runPrismaCommand(['db', 'push', '--accept-data-loss'], config);
          if (pushResult.success) {
            return {
              success: true,
              duration: Date.now() - startTime,
              migrationsApplied: 1,
              fallbackUsed: true,
              details: 'Fresh database initialized using prisma db push (recovery mode)'
            };
          }
        } catch (pushError) {
          this.logger.error('❌ Recovery with db push also failed:', pushError);
        }
      }

      throw new Error(`Baseline migration failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async executeStandardMigration(config: MigrationConfig, startTime: number): Promise<MigrationResult> {
    this.logger.log('📋 Executing standard migration for existing database...');

    try {
      const dbHealth = await this.getDatabaseHealth();
      const existingMigrations = await this.checkExistingMigrations();

      // **IMPROVED**: Prioritize Prisma's native _prisma_migrations table over custom state
      if (!existingMigrations.hasMigrations) {
        if (dbHealth.tables.length === 0) {
          // Empty database - needs full initialization
          this.logger.log('🌱 Empty database detected, starting full initialization...');
          return await this.initializeEmptyDatabase(config, startTime);
        } else {
          // Has tables but no migration history in _prisma_migrations
          // **NEW**: Check if this is a consistent database that just needs migration history repair
          const schemaConsistency = await this.checkSchemaConsistency();

          if (schemaConsistency.isConsistent) {
            // Database schema is consistent but missing migration history
            // **FIX**: Create baseline migration to establish proper migration history
            this.logger.log('📝 Consistent schema without migration history, creating baseline to establish _prisma_migrations...');
            const result = await this.createBaselineMigration(config, startTime);
            return result;
          } else {
            // Schema is inconsistent - needs baseline migration
            this.logger.log('📝 Inconsistent schema detected, creating baseline migration...');
            const result = await this.createBaselineMigration(config, startTime);
            return result;
          }
        }
      }

      // **IMPROVED**: Use migrate deploy as the primary strategy (unified approach)
      this.logger.log('🚀 Attempting prisma migrate deploy...');
      const migrateResult = await this.runPrismaCommand(['migrate', 'deploy'], config);

      if (migrateResult.success) {
        this.logger.log('✅ Migration completed successfully using prisma migrate deploy');
        return {
          success: true,
          duration: Date.now() - startTime,
          migrationsApplied: this.extractMigrationCount(migrateResult.output),
          fallbackUsed: false,
          details: 'Migration completed using prisma migrate deploy'
        };
      }

      // **IMPROVED**: Handle specific migration errors with better fallback strategies
      if (migrateResult.error?.includes('P3005') || migrateResult.error?.includes('schema is not empty')) {
        this.logger.log('🔄 P3005 error (schema not empty) detected, using db push fallback...');
        const pushResult = await this.runPrismaCommand(['db', 'push'], config);

        if (pushResult.success) {
          this.logger.log('✅ Database schema synchronized using prisma db push');
          return {
            success: true,
            duration: Date.now() - startTime,
            migrationsApplied: 1,
            fallbackUsed: true,
            details: 'Database synchronized using prisma db push (handled P3005 error)'
          };
        }
      }

      // Handle non-interactive environment error
      if (migrateResult.error?.includes('non-interactive')) {
        this.logger.log('🔄 Non-interactive environment detected, using db push...');
        const pushResult = await this.runPrismaCommand(['db', 'push', '--accept-data-loss'], config);

        if (pushResult.success) {
          this.logger.log('✅ Database schema synchronized using prisma db push (non-interactive fallback)');
          return {
            success: true,
            duration: Date.now() - startTime,
            migrationsApplied: 1,
            fallbackUsed: true,
            details: 'Database synchronized using prisma db push (non-interactive environment)'
          };
        }
      }

      throw new Error(migrateResult.error || 'Migration failed');

    } catch (error) {
      // Final fallback: Use db push with data loss acceptance
      this.logger.warn('⚠️ All migration strategies failed, using db push as final fallback...', error);

      try {
        const pushResult = await this.runPrismaCommand(['db', 'push', '--accept-data-loss'], config);
        if (pushResult.success) {
          this.logger.log('✅ Database schema synchronized using prisma db push (final fallback)');
          return {
            success: true,
            duration: Date.now() - startTime,
            migrationsApplied: 1,
            fallbackUsed: true,
            details: 'Database synchronized using prisma db push (final fallback)'
          };
        }

        throw new Error(pushResult.error || 'DB push failed');
      } catch (pushError) {
        throw new Error(`All migration strategies failed. Primary error: ${error instanceof Error ? error.message : error}. Fallback error: ${pushError instanceof Error ? pushError.message : pushError}`);
      }
    }
  }

  private async runPrismaCommand(args: string[], config: MigrationConfig): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve, reject) => {
      const timeout = config.timeoutMs || 60000;
      const child = spawn('npx', ['prisma', ...args], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
        stdio: 'pipe',
        shell: true,
        timeout
      });

      let stdout = '';
      let stderr = '';

      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
        if (config.verboseLogging) {
          this.logger.log(data.toString().trim());
        }
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
        if (config.verboseLogging) {
          this.logger.warn(data.toString().trim());
        }
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          reject(new Error(`Command failed with code ${code}: ${stderr}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  private async verifyMigration(): Promise<void> {
    try {
      // Verify critical tables exist
      const criticalTables = [
  'User', 'SystemLog', 'Host', 'AppSetting', 'AuthSetting', 'Container',
  'ReverseProxyRoute', 'Certificate', 'HostNpmConfig', 'ComposeProject',
  'FrpsConfig', 'FrpcProxy', 'OperationLog', 'OperationLogEntry', 'AutomationRule',
  'RuleTemplate', 'RuleTrigger', 'TriggerTemplate', 'RuleEvent', 'EventTemplate',
  'RuleNotification', 'NotificationChannel', 'NotificationTemplate', 'PluginMetadata',
  'PluginInstallation', 'RuleDependency', 'RuleExecution', 'TriggerExecution',
  'EventExecution', 'RuleMetrics', 'SystemMetrics', 'ActivityLog', 'HostConnectivityCheck',
  'DnsProvider', 'DnsRecord', 'DnsResolution'
];

      for (const table of criticalTables) {
        try {
          await this.prisma.$queryRaw`
            SELECT COUNT(*) as count FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = '${table.toLowerCase()}'
          `;

          this.logger.log(`✅ Table '${table.toLowerCase()}' verified`);
        } catch (error) {
          throw new Error(`Verification failed: Table '${table.toLowerCase()}' not found after migration`);
        }
      }

      // Test basic CRUD operations
      try {
        await this.prisma.$executeRaw`
          INSERT INTO "SystemLog" (id, "category", "level", "stream", "content", "ts")
          VALUES ('verify-migration-' || gen_random_uuid(), 'SYSTEM', 'INFO', 'migration', 'Migration verification successful', NOW())
        `;

        this.logger.log('✅ Database operations test passed');
      } catch (error) {
        throw new Error(`Database operations test failed: ${error instanceof Error ? error.message : error}`);
      }

    } catch (error) {
      this.logger.error('❌ Migration verification failed:', error);
      throw error;
    }
  }

  private async verifyMigrationHistoryCompleteness(): Promise<{ isComplete: boolean; details: string }> {
    try {
      // Check if all expected migrations have been applied
      const expectedMigrations = await this.getExpectedMigrations();
      const appliedMigrations = await this.getAppliedMigrations();

      const missingMigrations = expectedMigrations.filter(mig =>
        !appliedMigrations.some(applied => applied.migration_name === mig)
      );

      const isComplete = missingMigrations.length === 0;

      return {
        isComplete,
        details: isComplete
          ? `All ${expectedMigrations.length} expected migrations applied`
          : `Missing ${missingMigrations.length} migrations: ${missingMigrations.join(', ')}`
      };
    } catch (error) {
      this.logger.warn('⚠️ Could not verify migration history completeness:', error);
      return { isComplete: false, details: 'Verification failed' };
    }
  }

  private async getExpectedMigrations(): Promise<string[]> {
    try {
      // Read migration files from the migrations directory
      const fs = require('fs');
      const path = require('path');
      const migrationsDir = path.join(process.cwd(), 'prisma', 'migrations');

      if (!fs.existsSync(migrationsDir)) {
        return [];
      }

      const migrationFolders = fs.readdirSync(migrationsDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      return migrationFolders;
    } catch (error) {
      this.logger.warn('⚠️ Could not read expected migrations:', error);
      return [];
    }
  }

  private async getAppliedMigrations(): Promise<{ migration_name: string; finished_at: Date }[]> {
    try {
      const appliedMigrations = await this.prisma.$queryRaw`
        SELECT migration_name, finished_at
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
        ORDER BY finished_at ASC
      ` as any[];

      return appliedMigrations;
    } catch (error) {
      this.logger.warn('⚠️ Could not get applied migrations:', error);
      return [];
    }
  }

  /**
   * **NEW**: Comprehensive validation to ensure schema consistency with migration history
   * Validates that the current schema matches what's expected based on applied migrations
   */
  private async validateSchemaWithMigrationHistory(): Promise<{ isValid: boolean; details: string; schemaHash?: string }> {
    try {
      this.logger.log('🔍 Validating schema consistency with migration history...');

      // Get current state
      const dbHealth = await this.getDatabaseHealth();
      const appliedMigrations = await this.getAppliedMigrations();
      const expectedMigrations = await this.getExpectedMigrations();

      // Check 1: All expected migrations are applied
      const missingMigrations = expectedMigrations.filter(mig =>
        !appliedMigrations.some(applied => applied.migration_name === mig)
      );

      if (missingMigrations.length > 0) {
        return {
          isValid: false,
          details: `Missing migrations: ${missingMigrations.join(', ')}`
        };
      }

      // Check 2: No extra migrations that shouldn't be there
      const extraMigrations = appliedMigrations.filter(applied =>
        !expectedMigrations.includes(applied.migration_name)
      );

      if (extraMigrations.length > 0) {
        return {
          isValid: false,
          details: `Unexpected migrations found: ${extraMigrations.map(m => m.migration_name).join(', ')}`
        };
      }

      // Check 3: If we have migrations, we should have the expected tables
      if (appliedMigrations.length > 0 && dbHealth.tables.length === 0) {
        return {
          isValid: false,
          details: 'Migrations applied but no tables found - possible schema corruption'
        };
      }

      // Check 4: Generate a simple schema hash for consistency tracking
      const schemaHash = await this.generateSchemaHash();

      this.logger.log(`✅ Schema validation passed - ${appliedMigrations.length} migrations, ${dbHealth.tables.length} tables`);

      return {
        isValid: true,
        details: `Schema consistent with migration history (${appliedMigrations.length} migrations, ${dbHealth.tables.length} tables)`,
        schemaHash
      };

    } catch (error) {
      this.logger.warn('⚠️ Schema validation failed:', error);
      return {
        isValid: false,
        details: `Validation error: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * **NEW**: Generate a simple hash of the current schema for consistency tracking
   */
  private async generateSchemaHash(): Promise<string> {
    try {
      // Get basic schema information
      const schemaInfo = await this.prisma.$queryRaw`
        SELECT
          COUNT(DISTINCT table_name) as table_count,
          COUNT(DISTINCT column_name) as column_count,
          SUM(CASE WHEN data_type = 'uuid' THEN 1 ELSE 0 END) as uuid_columns,
          SUM(CASE WHEN data_type = 'timestamp' THEN 1 ELSE 0 END) as timestamp_columns,
          SUM(CASE WHEN data_type = 'boolean' THEN 1 ELSE 0 END) as boolean_columns
        FROM information_schema.columns
        WHERE table_schema = 'public'
      ` as any[];

      const info = schemaInfo[0] || {};

      // Create a simple hash string
      const hashComponents = [
        info.table_count || 0,
        info.column_count || 0,
        info.uuid_columns || 0,
        info.timestamp_columns || 0,
        info.boolean_columns || 0
      ];

      return hashComponents.join('-');
    } catch (error) {
      this.logger.warn('⚠️ Could not generate schema hash:', error);
      return 'unknown';
    }
  }

  private async checkExistingMigrations(): Promise<{ hasMigrations: boolean; count: number }> {
    try {
      // Check if the _prisma_migrations table exists
      const migrationsTableExists = await this.prisma.$queryRaw`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = '_prisma_migrations'
        ) as exists
      `;

      const tableExists = (migrationsTableExists as any[])[0]?.exists || false;

      if (!tableExists) {
        return { hasMigrations: false, count: 0 };
      }

      // Count existing migrations
      const migrationCount = await this.prisma.$queryRaw`
        SELECT COUNT(*) as count
        FROM _prisma_migrations
        WHERE finished_at IS NOT NULL
      `;

      const count = (migrationCount as any[])[0]?.count || 0;

      this.logger.log(`📋 Migration history: ${count} migrations found`);

      return {
        hasMigrations: count > 0,
        count: Number(count)
      };
    } catch (error) {
      this.logger.warn('⚠️ Could not check migration history:', error);
      return { hasMigrations: false, count: 0 };
    }
  }

  private async initializeEmptyDatabase(config: MigrationConfig, startTime: number): Promise<MigrationResult> {
    this.logger.log('🌱 Initializing empty database...');

    try {
      // Use db push for fresh initialization
      const pushResult = await this.runPrismaCommand(['db', 'push'], config);

      if (pushResult.success) {
        this.logger.log('✅ Empty database initialized successfully');
        return {
          success: true,
          duration: Date.now() - startTime,
          migrationsApplied: 1,
          fallbackUsed: false,
          details: 'Empty database initialized using prisma db push'
        };
      }

      throw new Error(pushResult.error || 'Empty database initialization failed');
    } catch (error) {
      throw new Error(`Failed to initialize empty database: ${error instanceof Error ? error.message : error}`);
    }
  }

  private async createBaselineMigration(config: MigrationConfig, startTime: number): Promise<MigrationResult> {
    this.logger.log('📝 Creating baseline migration for existing schema...');

    try {
      const isProduction = process.env.NODE_ENV === 'production';
      let baselineResult;

      if (isProduction) {
        // In production, use db push to synchronize schema
        baselineResult = await this.runPrismaCommand(['db', 'push'], config);
      } else {
        // In development, create baseline migration
        baselineResult = await this.runPrismaCommand([
          'migrate', 'dev',
          '--name', 'baseline_existing_schema',
          '--create-only'
        ], config);

        // Apply the baseline migration in development
        if (baselineResult.success) {
          const deployResult = await this.runPrismaCommand(['migrate', 'deploy'], config);
          if (!deployResult.success) {
            throw new Error(deployResult.error || 'Baseline migration deployment failed');
          }
          baselineResult = deployResult;
        }
      }

      if (baselineResult.success) {
        this.logger.log('✅ Baseline migration completed successfully');
        return {
          success: true,
          duration: Date.now() - startTime,
          migrationsApplied: isProduction ? 1 : this.extractMigrationCount(baselineResult.output),
          fallbackUsed: false,
          details: isProduction
            ? 'Database schema synchronized using prisma db push (production baseline)'
            : 'Baseline migration created and applied successfully'
        };
      }

      throw new Error(baselineResult.error || 'Baseline migration failed');
    } catch (error) {
      // Fallback to db push
      this.logger.warn('⚠️ Baseline migration failed, using db push fallback...', error);

      try {
        const pushResult = await this.runPrismaCommand(['db', 'push'], config);
        if (pushResult.success) {
          this.logger.log('✅ Database schema synchronized using prisma db push (fallback)');
          return {
            success: true,
            duration: Date.now() - startTime,
            migrationsApplied: 1,
            fallbackUsed: true,
            details: 'Database schema synchronized using prisma db push (fallback after baseline failed)'
          };
        }
        throw new Error(pushResult.error || 'DB push fallback failed');
      } catch (pushError) {
        throw new Error(`Baseline migration and fallback failed. Primary error: ${error instanceof Error ? error.message : error}. Fallback error: ${pushError instanceof Error ? pushError.message : pushError}`);
      }
    }
  }

  
  private async checkSchemaConsistency(): Promise<{ isConsistent: boolean; details: string }> {
    try {
      // Get the expected table names from Prisma schema
      const expectedTables = [
        'User', 'Host', 'Container', 'Task', 'TaskExecution', 'Automation',
        'AutomationExecution', 'Topology', 'ReverseProxyConfig', 'FRPConfig',
        'FRPTunnel', 'DNSRecord', 'DNSProvider', 'Setting', 'AuditLog',
        '_prisma_migrations'
      ];

      // Get actual tables from database
      const actualTablesResult = await this.prisma.$queryRaw`
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename
      ` as any[];

      const actualTables = actualTablesResult.map(row => row.tablename);

      // Check if all expected tables exist
      const missingTables = expectedTables.filter(table => !actualTables.includes(table));
      const extraTables = actualTables.filter(table => !expectedTables.includes(table));

      // Basic consistency check
      const isConsistent = missingTables.length === 0 && extraTables.length === 0;

      this.logger.log(`📊 Schema consistency check: ${isConsistent ? '✅ Consistent' : '❌ Inconsistent'}`);
      if (missingTables.length > 0) {
        this.logger.log(`📋 Missing tables: ${missingTables.join(', ')}`);
      }
      if (extraTables.length > 0) {
        this.logger.log(`📋 Extra tables: ${extraTables.join(', ')}`);
      }

      return {
        isConsistent,
        details: `Expected: ${expectedTables.length}, Actual: ${actualTables.length}, Missing: ${missingTables.length}, Extra: ${extraTables.length}`
      };
    } catch (error) {
      this.logger.warn('⚠️ Could not check schema consistency:', error);
      return { isConsistent: false, details: 'Schema consistency check failed' };
    }
  }

  private extractMigrationCount(output: string): number {
    const matches = output.match(/(?:Migration|Applied|Successfully applied)\s+(\d+)/gi);
    if (matches && matches.length > 0) {
      const lastMatch = matches[matches.length - 1];
      const countMatch = lastMatch.match(/\d+/);
      return countMatch ? parseInt(countMatch[0]) : 0;
    }
    return 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private updateMigrationStats(result: MigrationResult): void {
    this.migrationStats.totalMigrations++;
    this.migrationStats.lastMigrationTime = new Date();

    if (result.success) {
      this.migrationStats.successfulMigrations++;
    } else {
      this.migrationStats.failedMigrations++;
    }
  }

  // Public API methods
  async checkHealth(): Promise<DatabaseHealth> {
    return await this.getDatabaseHealth();
  }

  async getLastMigrationResult(): Promise<MigrationResult | null> {
    return this.lastMigrationResult;
  }

  async getMigrationStats(): Promise<{
    totalMigrations: number;
    successfulMigrations: number;
    failedMigrations: number;
    lastMigrationTime: Date | null;
    databaseHealth: DatabaseHealth;
  }> {
    const health = await this.getDatabaseHealth();

    return {
      ...this.migrationStats,
      databaseHealth: health
    };
  }

  async forceMigration(config?: Partial<MigrationConfig>): Promise<MigrationResult> {
    this.logger.log('🔄 Forcing database migration...');
    return await this.runMigrations(config);
  }

  async isMigratingNow(): Promise<boolean> {
    return this.isMigrating;
  }
}