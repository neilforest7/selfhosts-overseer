import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';
import { DnsStatus } from '@prisma/client';

interface DnsHealthMetrics {
  totalRecords: number;
  enabledRecords: number;
  healthyRecords: number;
  failedRecords: number;
  unknownRecords: number;
  avgResponseTime: number;
  successRate: number;
  recordsWithIssues: Array<{
    id: string;
    domain: string;
    status: string;
    lastError?: string;
    lastCheckAt?: Date;
  }>;
}

@Injectable()
export class DnsMonitoringService {
  private readonly logger = new Logger(DnsMonitoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activityLog: ActivityLogService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
  ) {}

  // Health check every 5 minutes
  @Cron(CronExpression.EVERY_5_MINUTES)
  async performHealthCheck() {
    const opLog = await this.operationLogService.create({
      title: 'DNS Health Check',
      triggerType: 'SCHEDULE',
    });

    try {
      await this.contextService.run(opLog.id, async () => {
        const metrics = await this.calculateHealthMetrics();
        await this.checkForAlerts(metrics);
        await this.logHealthStatus(metrics);
      });

      await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`DNS health check failed: ${errorMessage}`);
      await this.operationLogService.updateStatus(opLog.id, 'ERROR');
    }
  }

  // Cleanup old resolution records every day at 2 AM
  @Cron('0 2 * * *')
  async cleanupOldRecords() {
    const opLog = await this.operationLogService.create({
      title: 'DNS Records Cleanup',
      triggerType: 'SCHEDULE',
    });

    try {
      await this.contextService.run(opLog.id, async () => {
        const retentionDays = 30; // Keep 30 days of resolution history
        const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

        const deletedCount = await this.prisma.dnsResolution.deleteMany({
          where: {
            checkedAt: {
              lt: cutoffDate,
            },
          },
        });

        this.logger.log(`Cleaned up ${deletedCount.count} old DNS resolution records`);

        await this.activityLog.create({
          category: 'DNS_RESOLUTION' as any,
          action: 'cleanup_completed',
          resourceType: 'dns_resolution',
          title: 'DNS resolution cleanup completed',
          description: `Cleaned up ${deletedCount.count} old DNS resolution records older than ${retentionDays} days`,
          metadata: {
            deletedCount: deletedCount.count,
            retentionDays,
            cutoffDate: cutoffDate.toISOString(),
          },
        });
      });

      await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`DNS cleanup failed: ${errorMessage}`);
      await this.operationLogService.updateStatus(opLog.id, 'ERROR');
    }
  }

  async calculateHealthMetrics(): Promise<DnsHealthMetrics> {
    const [records, recentResolutions] = await Promise.all([
      this.prisma.dnsRecord.findMany({
        include: {
          provider: true,
        },
      }),
      this.prisma.dnsResolution.findMany({
        where: {
          checkedAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
          },
        },
        include: {
          dnsRecord: true,
        },
      }),
    ]);

    const totalRecords = records.length;
    const enabledRecords = records.filter(r => r.isEnabled).length;
    const healthyRecords = records.filter(r => r.status === DnsStatus.RESOLVED).length;
    const failedRecords = records.filter(r => r.status === DnsStatus.FAILED).length;
    const unknownRecords = records.filter(r => r.status === DnsStatus.UNKNOWN).length;

    const successfulResolutions = recentResolutions.filter(r => r.status === DnsStatus.RESOLVED);
    const avgResponseTime = successfulResolutions.length > 0
      ? successfulResolutions.reduce((sum, r) => sum + (r.responseTime || 0), 0) / successfulResolutions.length
      : 0;

    const successRate = recentResolutions.length > 0
      ? (successfulResolutions.length / recentResolutions.length) * 100
      : 0;

    const recordsWithIssues = records
      .filter(r => r.isEnabled && (r.status === DnsStatus.FAILED || r.status === DnsStatus.TIMEOUT))
      .map(r => ({
        id: r.id,
        domain: r.domain,
        status: r.status as string,
        lastError: r.errorMessage || undefined,
        lastCheckAt: r.lastCheckAt || undefined,
      }));

    return {
      totalRecords,
      enabledRecords,
      healthyRecords,
      failedRecords,
      unknownRecords,
      avgResponseTime,
      successRate,
      recordsWithIssues,
    };
  }

  private async checkForAlerts(metrics: DnsHealthMetrics) {
    // Alert if success rate drops below 90%
    if (metrics.successRate < 90 && metrics.enabledRecords > 0) {
      await this.activityLog.create({
        category: 'DNS_RESOLUTION' as any,
        action: 'low_success_rate_alert',
        resourceType: 'dns_system',
        title: 'DNS Success Rate Alert',
        description: `DNS success rate has dropped to ${metrics.successRate.toFixed(1)}% (below 90% threshold)`,
        metadata: {
          successRate: metrics.successRate,
          threshold: 90,
          enabledRecords: metrics.enabledRecords,
          failedRecords: metrics.failedRecords,
        },
      });
    }

    // Alert for records that have been failing for more than 1 hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const persistentFailures = metrics.recordsWithIssues.filter(
      r => r.lastCheckAt && r.lastCheckAt < oneHourAgo
    );

    if (persistentFailures.length > 0) {
      await this.activityLog.create({
        category: 'DNS_RESOLUTION' as any,
        action: 'persistent_failures_alert',
        resourceType: 'dns_system',
        title: 'Persistent DNS Failures Alert',
        description: `${persistentFailures.length} DNS records have been failing for more than 1 hour`,
        metadata: {
          failureCount: persistentFailures.length,
          failedDomains: persistentFailures.map(r => r.domain),
          threshold: '1 hour',
        },
      });
    }
  }

  private async logHealthStatus(metrics: DnsHealthMetrics) {
    this.logger.log(
      `DNS Health: ${metrics.healthyRecords}/${metrics.enabledRecords} healthy, ` +
      `${metrics.successRate.toFixed(1)}% success rate, ` +
      `${metrics.avgResponseTime.toFixed(0)}ms avg response time`
    );

    // Log detailed health status every hour
    const now = new Date();
    if (now.getMinutes() === 0) {
      await this.activityLog.create({
        category: 'DNS_RESOLUTION' as any,
        action: 'health_status_report',
        resourceType: 'dns_system',
        title: 'DNS System Health Report',
        description: `System health: ${metrics.healthyRecords}/${metrics.enabledRecords} records healthy`,
        metadata: {
          totalRecords: metrics.totalRecords,
          enabledRecords: metrics.enabledRecords,
          healthyRecords: metrics.healthyRecords,
          failedRecords: metrics.failedRecords,
          unknownRecords: metrics.unknownRecords,
          successRate: metrics.successRate,
          avgResponseTime: metrics.avgResponseTime,
          recordsWithIssues: metrics.recordsWithIssues.length,
        },
      });
    }
  }

  async getSystemHealth(): Promise<DnsHealthMetrics> {
    return this.calculateHealthMetrics();
  }

  async getRecentAlerts(hours = 24): Promise<any[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return this.prisma.activityLog.findMany({
      where: {
        category: 'DNS_RESOLUTION' as any,
        action: {
          in: ['low_success_rate_alert', 'persistent_failures_alert'],
        },
        timestamp: {
          gte: since,
        },
      },
      orderBy: { timestamp: 'desc' },
    });
  }
}
