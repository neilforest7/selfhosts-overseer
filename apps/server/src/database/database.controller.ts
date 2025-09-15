import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { DatabaseMigrationService, MigrationConfig, MigrationResult, DatabaseHealth } from './database-migration.service';

@Controller('api/v1/database')
export class DatabaseController {
  constructor(private readonly databaseMigrationService: DatabaseMigrationService) {}

  @Get('health')
  async getHealth(): Promise<DatabaseHealth> {
    return await this.databaseMigrationService.checkHealth();
  }

  @Get('migration/status')
  async getMigrationStatus(): Promise<{
    totalMigrations: number;
    successfulMigrations: number;
    failedMigrations: number;
    lastMigrationTime: Date | null;
    databaseHealth: DatabaseHealth;
  }> {
    return await this.databaseMigrationService.getMigrationStats();
  }

  @Get('migration/last')
  async getLastMigration(): Promise<MigrationResult | null> {
    return await this.databaseMigrationService.getLastMigrationResult();
  }

  @Get('migration/is-migrating')
  async isMigrating(): Promise<{ isMigrating: boolean }> {
    const isMigrating = await this.databaseMigrationService.isMigratingNow();
    return { isMigrating };
  }

  @Post('migration/run')
  @HttpCode(HttpStatus.OK)
  async runMigration(@Body() config?: Partial<MigrationConfig>): Promise<MigrationResult> {
    return await this.databaseMigrationService.runMigrations(config);
  }

  @Post('migration/force')
  @HttpCode(HttpStatus.OK)
  async forceMigration(@Body() config?: Partial<MigrationConfig>): Promise<MigrationResult> {
    return await this.databaseMigrationService.forceMigration(config);
  }

  @Get('info')
  async getDatabaseInfo(): Promise<{
    health: DatabaseHealth;
    stats: {
      totalMigrations: number;
      successfulMigrations: number;
      failedMigrations: number;
      lastMigrationTime: Date | null;
    };
    lastResult: MigrationResult | null;
    isMigrating: boolean;
  }> {
    const [health, stats, lastResult, isMigrating] = await Promise.all([
      this.databaseMigrationService.checkHealth(),
      this.databaseMigrationService.getMigrationStats(),
      this.databaseMigrationService.getLastMigrationResult(),
      this.databaseMigrationService.isMigratingNow()
    ]);

    return {
      health,
      stats,
      lastResult,
      isMigrating
    };
  }
}