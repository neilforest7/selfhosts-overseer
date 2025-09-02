import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ActivityLogService } from './activity-log.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ActivityLogCleanupService {
  private readonly logger = new Logger(ActivityLogCleanupService.name);

  constructor(
    private readonly activityLogService: ActivityLogService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Run cleanup daily at 2:00 AM
   */
  @Cron('0 2 * * *')
  async handleDailyCleanup() {
    this.logger.log('Starting daily activity log cleanup...');

    try {
      const settings = await this.settingsService.get();

      if (!settings.activityLogCleanupEnabled) {
        this.logger.log('Activity log cleanup is disabled in settings, skipping...');
        return;
      }

      const retentionDays = settings.activityLogRetentionDays || 30;

      const result = await this.activityLogService.cleanup(retentionDays);

      this.logger.log(
        `Daily cleanup completed: ${result.count} activity log entries removed (retention: ${retentionDays} days)`
      );
    } catch (error) {
      this.logger.error('Failed to run daily activity log cleanup', error instanceof Error ? error.stack : String(error));
    }
  }

  /**
   * Run weekly statistics cleanup on Sundays at 3:00 AM
   */
  @Cron('0 3 * * 0')
  async handleWeeklyStatisticsCleanup() {
    this.logger.log('Starting weekly activity log statistics cleanup...');
    
    try {
      // Clean up very old entries (older than 90 days) regardless of settings
      const result = await this.activityLogService.cleanup(90);
      
      this.logger.log(
        `Weekly statistics cleanup completed: ${result.count} old activity log entries removed`
      );
    } catch (error) {
      this.logger.error('Failed to run weekly activity log statistics cleanup', error instanceof Error ? error.stack : String(error));
    }
  }

  /**
   * Manual cleanup method that can be called via API
   */
  async runManualCleanup(retentionDays?: number): Promise<{ count: number; retentionDays: number }> {
    this.logger.log('Starting manual activity log cleanup...');
    
    try {
      const settings = await this.settingsService.get();
      const actualRetentionDays = retentionDays || settings.activityLogRetentionDays || 30;
      
      const result = await this.activityLogService.cleanup(actualRetentionDays);
      
      this.logger.log(
        `Manual cleanup completed: ${result.count} activity log entries removed (retention: ${actualRetentionDays} days)`
      );
      
      return {
        count: result.count,
        retentionDays: actualRetentionDays,
      };
    } catch (error) {
      this.logger.error('Failed to run manual activity log cleanup', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    totalEntries: number;
    entriesOlderThan30Days: number;
    entriesOlderThan90Days: number;
    oldestEntry?: Date;
    newestEntry?: Date;
  }> {
    try {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      const [
        totalEntries,
        entriesOlderThan30Days,
        entriesOlderThan90Days,
        oldestEntry,
        newestEntry,
      ] = await Promise.all([
        this.activityLogService['prisma'].activityLog.count(),
        this.activityLogService['prisma'].activityLog.count({
          where: { timestamp: { lt: thirtyDaysAgo } },
        }),
        this.activityLogService['prisma'].activityLog.count({
          where: { timestamp: { lt: ninetyDaysAgo } },
        }),
        this.activityLogService['prisma'].activityLog.findFirst({
          orderBy: { timestamp: 'asc' },
          select: { timestamp: true },
        }),
        this.activityLogService['prisma'].activityLog.findFirst({
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        }),
      ]);

      return {
        totalEntries,
        entriesOlderThan30Days,
        entriesOlderThan90Days,
        oldestEntry: oldestEntry?.timestamp,
        newestEntry: newestEntry?.timestamp,
      };
    } catch (error) {
      this.logger.error('Failed to get cleanup statistics', error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }
}
