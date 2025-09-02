import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class ConnectivityCleanupService {
  private readonly logger = new Logger(ConnectivityCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Clean up old connectivity check records
   * Runs daily at 2:00 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldConnectivityChecks(): Promise<void> {
    this.logger.log('Starting connectivity check records cleanup...');

    try {
      const settings = await this.settingsService.get();
      const retentionDays = settings.activityLogRetentionDays || 30; // Use same retention as activity logs
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Delete old connectivity check records
      const deleteResult = await this.prisma.hostConnectivityCheck.deleteMany({
        where: {
          checkedAt: {
            lt: cutoffDate,
          },
        },
      });

      this.logger.log(
        `Cleanup completed. Deleted ${deleteResult.count} connectivity check records older than ${retentionDays} days.`
      );

      // Also clean up orphaned records (where host no longer exists)
      const orphanedResult = await this.prisma.hostConnectivityCheck.deleteMany({
        where: {
          host: null,
        },
      });

      if (orphanedResult.count > 0) {
        this.logger.log(`Deleted ${orphanedResult.count} orphaned connectivity check records.`);
      }

    } catch (error) {
      this.logger.error(`Failed to cleanup connectivity check records: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Manual cleanup with custom retention period
   */
  async manualCleanup(retentionDays: number): Promise<{
    deletedRecords: number;
    deletedOrphaned: number;
  }> {
    this.logger.log(`Starting manual connectivity cleanup with ${retentionDays} days retention...`);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    // Delete old records
    const deleteResult = await this.prisma.hostConnectivityCheck.deleteMany({
      where: {
        checkedAt: {
          lt: cutoffDate,
        },
      },
    });

    // Delete orphaned records
    const orphanedResult = await this.prisma.hostConnectivityCheck.deleteMany({
      where: {
        host: null,
      },
    });

    this.logger.log(
      `Manual cleanup completed. Deleted ${deleteResult.count} old records and ${orphanedResult.count} orphaned records.`
    );

    return {
      deletedRecords: deleteResult.count,
      deletedOrphaned: orphanedResult.count,
    };
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(): Promise<{
    totalRecords: number;
    oldestRecord: Date | null;
    newestRecord: Date | null;
    recordsPerHost: Array<{ hostId: string; hostName: string; count: number }>;
  }> {
    const totalRecords = await this.prisma.hostConnectivityCheck.count();

    const oldestRecord = await this.prisma.hostConnectivityCheck.findFirst({
      orderBy: { checkedAt: 'asc' },
      select: { checkedAt: true },
    });

    const newestRecord = await this.prisma.hostConnectivityCheck.findFirst({
      orderBy: { checkedAt: 'desc' },
      select: { checkedAt: true },
    });

    const recordsPerHost = await this.prisma.hostConnectivityCheck.groupBy({
      by: ['hostId'],
      _count: {
        id: true,
      },
      orderBy: {
        _count: {
          id: 'desc',
        },
      },
    });

    // Get host names for the records
    const hostIds = recordsPerHost.map(r => r.hostId);
    const hosts = await this.prisma.host.findMany({
      where: { id: { in: hostIds } },
      select: { id: true, name: true },
    });

    const hostMap = new Map(hosts.map(h => [h.id, h.name]));

    const recordsWithNames = recordsPerHost.map(r => ({
      hostId: r.hostId,
      hostName: hostMap.get(r.hostId) || 'Unknown',
      count: r._count.id,
    }));

    return {
      totalRecords,
      oldestRecord: oldestRecord?.checkedAt || null,
      newestRecord: newestRecord?.checkedAt || null,
      recordsPerHost: recordsWithNames,
    };
  }

  /**
   * Optimize connectivity check storage
   * Keep only the most recent N records per host
   */
  async optimizeStorage(maxRecordsPerHost = 1000): Promise<{
    deletedRecords: number;
    hostsProcessed: number;
  }> {
    this.logger.log(`Starting storage optimization, keeping max ${maxRecordsPerHost} records per host...`);

    const hosts = await this.prisma.host.findMany({
      select: { id: true, name: true },
    });

    let totalDeleted = 0;
    let hostsProcessed = 0;

    for (const host of hosts) {
      // Get count of records for this host
      const recordCount = await this.prisma.hostConnectivityCheck.count({
        where: { hostId: host.id },
      });

      if (recordCount > maxRecordsPerHost) {
        // Get IDs of records to keep (most recent ones)
        const recordsToKeep = await this.prisma.hostConnectivityCheck.findMany({
          where: { hostId: host.id },
          orderBy: { checkedAt: 'desc' },
          take: maxRecordsPerHost,
          select: { id: true },
        });

        const keepIds = recordsToKeep.map(r => r.id);

        // Delete old records
        const deleteResult = await this.prisma.hostConnectivityCheck.deleteMany({
          where: {
            hostId: host.id,
            id: { notIn: keepIds },
          },
        });

        totalDeleted += deleteResult.count;
        hostsProcessed++;

        this.logger.debug(
          `Optimized host ${host.name}: deleted ${deleteResult.count} old records, kept ${maxRecordsPerHost}`
        );
      }
    }

    this.logger.log(
      `Storage optimization completed. Processed ${hostsProcessed} hosts, deleted ${totalDeleted} records.`
    );

    return {
      deletedRecords: totalDeleted,
      hostsProcessed,
    };
  }
}
