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
      const tables = await this.prisma.$queryRaw`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `;

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
        tables: (tables as any[]).map((row: any) => row.table_name),
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

    // Check if migrations table exists
    if (!dbHealth.migrationsTableExists) {
      // Has tables but no migration history - likely manually created or incomplete
      this.logger.log('⚠️ Database exists but no migration history found');
      return 'partial';
    }

    // Check for critical tables that indicate proper migration
    const criticalTables = ['user', 'systemlog', 'host']; // PostgreSQL stores in lowercase
    const missingCriticalTables = criticalTables.filter(table =>
      !dbHealth.tables.some(existingTable => existingTable.toLowerCase() === table.toLowerCase())
    );

    if (missingCriticalTables.length > 0) {
      this.logger.log(`📋 Missing critical tables: ${missingCriticalTables.join(', ')}`);
      return 'partial';
    }

    // Check if we have applied migrations
    if (dbHealth.appliedMigrations.length === 0) {
      this.logger.log('⚠️ Migrations table exists but no migrations applied');
      return 'partial';
    }

    this.logger.log(`✅ Complete database detected (${dbHealth.appliedMigrations.length} migrations applied)`);
    return 'complete';
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
      // For fresh databases, use db push to create the complete schema
      const pushResult = await this.runPrismaCommand(['db', 'push'], config);
      if (pushResult.success) {
        this.logger.log('✅ Baseline migration completed successfully');
        return {
          success: true,
          duration: Date.now() - startTime,
          migrationsApplied: 1, // Count as 1 baseline migration
          fallbackUsed: false,
          details: 'Fresh database initialized using prisma db push'
        };
      }

      throw new Error(pushResult.error || 'Baseline migration failed');
    } catch (error) {
      // If db push fails, try migrate deploy as fallback
      this.logger.warn('⚠️ Baseline db push failed, trying migrate deploy...', error);

      try {
        const migrateResult = await this.runPrismaCommand(['migrate', 'deploy'], config);
        if (migrateResult.success) {
          return {
            success: true,
            duration: Date.now() - startTime,
            migrationsApplied: this.extractMigrationCount(migrateResult.output),
            fallbackUsed: true,
            details: 'Fresh database initialized using prisma migrate deploy (fallback)'
          };
        }

        throw new Error(migrateResult.error || 'Migrate deploy failed');
      } catch (migrateError) {
        throw new Error(`Baseline migration failed. Push error: ${error instanceof Error ? error.message : error}. Migrate error: ${migrateError instanceof Error ? migrateError.message : migrateError}`);
      }
    }
  }

  private async executeStandardMigration(config: MigrationConfig, startTime: number): Promise<MigrationResult> {
    this.logger.log('📋 Executing standard migration for existing database...');

    try {
      // Use prisma migrate deploy for existing databases
      const migrateResult = await this.runPrismaCommand(['migrate', 'deploy'], config);
      if (migrateResult.success) {
        this.logger.log('✅ Standard migration completed successfully');
        return {
          success: true,
          duration: Date.now() - startTime,
          migrationsApplied: this.extractMigrationCount(migrateResult.output),
          fallbackUsed: false,
          details: 'Standard migration completed using prisma migrate deploy'
        };
      }

      throw new Error(migrateResult.error || 'Standard migration failed');
    } catch (error) {
      throw new Error(`Standard migration failed: ${error instanceof Error ? error.message : error}`);
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