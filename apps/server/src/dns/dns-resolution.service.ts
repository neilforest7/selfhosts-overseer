import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DnsProviderService } from './dns-provider.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { DnsRecord, DnsResolution, DnsStatus } from '@prisma/client';
import { DnsResolutionResult } from './interfaces/dns-provider.interface';

@Injectable()
export class DnsResolutionService {
  private readonly logger = new Logger(DnsResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dnsProviderService: DnsProviderService,
    private readonly activityLog: ActivityLogService,
    private readonly settingsService: SettingsService,
  ) {}

  async resolveRecord(recordId: string): Promise<DnsResolution> {
    const record = await this.prisma.dnsRecord.findUnique({
      where: { id: recordId },
      include: { provider: true },
    });

    if (!record) {
      throw new NotFoundException(`DNS record with ID '${recordId}' not found`);
    }

    if (!record.isEnabled) {
      throw new Error(`DNS record '${record.domain}' is disabled`);
    }

    // Check if this record type should be skipped based on settings
    const shouldSkip = await this.shouldSkipRecordType(record.recordType);
    if (shouldSkip) {
      this.logger.debug(`Skipping resolution for ${record.domain} (${record.recordType}) - non-address record type filtering enabled`);
      throw new Error(`Record type ${record.recordType} is filtered out by DNS settings`);
    }

    const provider = this.dnsProviderService.getProvider(record.provider.name);
    
    this.logger.log(`Resolving DNS record: ${record.domain} (${record.recordType}) via ${record.provider.displayName}`);

    try {
      const result = await provider.resolveRecord(record.domain, record.recordType);
      
      // Create resolution record
      const resolution = await this.createResolutionRecord(record, result);
      
      // Update the DNS record with latest status
      await this.updateDnsRecordStatus(record, result);
      
      // Log activity
      await this.logResolutionActivity(record, result);
      
      return resolution;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`DNS resolution failed for ${record.domain}: ${errorMessage}`);
      
      const failedResult: DnsResolutionResult = {
        domain: record.domain,
        recordType: record.recordType,
        responseTime: 0,
        status: DnsStatus.FAILED,
        errorMessage: errorMessage,
      };
      
      const resolution = await this.createResolutionRecord(record, failedResult);
      await this.updateDnsRecordStatus(record, failedResult);
      await this.logResolutionActivity(record, failedResult);
      
      return resolution;
    }
  }

  async batchResolve(recordIds: string[]): Promise<DnsResolution[]> {
    const results: DnsResolution[] = [];
    
    for (const recordId of recordIds) {
      try {
        const resolution = await this.resolveRecord(recordId);
        results.push(resolution);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to resolve record ${recordId}: ${errorMessage}`);
      }
    }
    
    return results;
  }

  async getResolutionHistory(recordId: string, limit = 100): Promise<DnsResolution[]> {
    return this.prisma.dnsResolution.findMany({
      where: { dnsRecordId: recordId },
      orderBy: { checkedAt: 'desc' },
      take: limit,
    });
  }

  async getRecentResolutions(hours = 24): Promise<DnsResolution[]> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    
    return this.prisma.dnsResolution.findMany({
      where: {
        checkedAt: {
          gte: since,
        },
      },
      include: {
        dnsRecord: {
          include: {
            provider: true,
          },
        },
      },
      orderBy: { checkedAt: 'desc' },
    });
  }

  private async createResolutionRecord(
    record: DnsRecord,
    result: DnsResolutionResult,
  ): Promise<DnsResolution> {
    return this.prisma.dnsResolution.create({
      data: {
        dnsRecordId: record.id,
        resolvedIp: result.resolvedIp,
        responseTime: result.responseTime,
        status: result.status,
        errorMessage: result.errorMessage,
        geoLocation: result.geoLocation,
      },
    });
  }

  private async updateDnsRecordStatus(
    record: DnsRecord,
    result: DnsResolutionResult,
  ): Promise<void> {
    const updateData: any = {
      lastCheckAt: new Date(),
      status: result.status,
      errorMessage: result.errorMessage,
    };

    // Update IP and change time if IP changed
    if (result.resolvedIp && result.resolvedIp !== record.currentIp) {
      updateData.currentIp = result.resolvedIp;
      updateData.lastChangeAt = new Date();
    }

    await this.prisma.dnsRecord.update({
      where: { id: record.id },
      data: updateData,
    });
  }

  private async logResolutionActivity(
    record: DnsRecord & { provider: any },
    result: DnsResolutionResult,
  ): Promise<void> {
    const isSuccess = result.status === DnsStatus.RESOLVED;
    const action = isSuccess ? 'resolution_success' : 'resolution_failed';
    
    await this.activityLog.create({
      category: 'DNS_RESOLUTION' as any,
      action,
      resourceType: 'dns_record',
      resourceId: record.id,
      resourceName: record.domain,
      title: `DNS resolution ${isSuccess ? 'succeeded' : 'failed'} for ${record.domain}`,
      description: isSuccess 
        ? `Resolved to ${result.resolvedIp} in ${result.responseTime}ms`
        : `Failed: ${result.errorMessage}`,
      metadata: {
        domain: record.domain,
        recordType: record.recordType,
        provider: record.provider.displayName,
        resolvedIp: result.resolvedIp,
        responseTime: result.responseTime,
        status: result.status,
        errorMessage: result.errorMessage,
      },
    });
  }

  /**
   * Check if a record type should be skipped based on DNS settings
   */
  private async shouldSkipRecordType(recordType: string): Promise<boolean> {
    try {
      const settings = await this.settingsService.get();

      // If filtering is disabled, don't skip any records
      if (!settings.dnsSkipNonAddressRecords) {
        return false;
      }

      // Only allow A, AAAA, and CNAME records when filtering is enabled (standard DNS record types)
      const allowedTypes = ['A', 'AAAA', 'CNAME'];
      return !allowedTypes.includes(recordType.toUpperCase());
    } catch (error) {
      // If we can't get settings, default to not skipping
      this.logger.warn(`Failed to get DNS settings for record type filtering: ${error}`);
      return false;
    }
  }

  async cleanupOldResolutions(retentionDays = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    
    const result = await this.prisma.dnsResolution.deleteMany({
      where: {
        checkedAt: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(`Cleaned up ${result.count} old DNS resolution records`);
    return result.count;
  }
}
