/**
 * Database migration interfaces and types
 */

export interface MigrationResult {
  success: boolean;
  duration: number;
  output: string;
  error?: string;
  appliedMigrations?: string[];
}

export interface MigrationConfig {
  timeoutMs: number;
  retryAttempts: number;
  retryDelayMs: number;
  useTransactions: boolean;
  forceReset: boolean;
  skipVerification: boolean;
}

export interface MigrationHealth {
  isConnected: boolean;
  hasMigrationsTable: boolean;
  hasRequiredTables: boolean;
  pendingMigrations: string[];
  lastMigration?: string;
}

export interface MigrationStats {
  totalMigrations: number;
  lastMigration?: string;
  databaseSize?: string;
  uptime?: number;
  connectionPool?: {
    total: number;
    active: number;
    idle: number;
  };
}

export interface MigrationEvent {
  type: 'START' | 'SUCCESS' | 'ERROR' | 'RETRY' | 'VERIFICATION';
  timestamp: Date;
  details?: any;
  error?: string;
}

export type MigrationLogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface MigrationOptions {
  dryRun?: boolean;
  force?: boolean;
  skipGenerate?: boolean;
  skipSeed?: boolean;
}

export interface DatabaseBackupConfig {
  enabled: boolean;
  provider: 'local' | 's3' | 'gcs';
  schedule: string; // cron expression
  retentionDays: number;
  compression: boolean;
}

export interface MigrationLock {
  id: string;
  acquiredAt: Date;
  expiresAt: Date;
  acquiredBy: string;
  migrationId?: string;
}