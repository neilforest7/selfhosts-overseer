import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DnsProviderService } from './dns-provider.service';
import { DnsResolutionService } from './dns-resolution.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { SettingsService } from '../settings/settings.service';
import { CreateDnsRecordDto, UpdateDnsRecordDto } from './dto/create-dns-record.dto';
import { DnsRecord, DnsProvider, DnsRecordType } from '@prisma/client';

@Injectable()
export class DnsService {
  private readonly logger = new Logger(DnsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dnsProviderService: DnsProviderService,
    private readonly dnsResolutionService: DnsResolutionService,
    private readonly activityLog: ActivityLogService,
    private readonly settingsService: SettingsService,
  ) {}

  async createRecord(dto: CreateDnsRecordDto): Promise<DnsRecord> {
    // Validate that the provider exists
    await this.dnsProviderService.findOne(dto.providerId);

    // Check if record already exists for this domain and provider
    const existingRecord = await this.prisma.dnsRecord.findUnique({
      where: {
        domain_providerId: {
          domain: dto.domain,
          providerId: dto.providerId,
        },
      },
    });

    if (existingRecord) {
      throw new BadRequestException(`DNS record for domain '${dto.domain}' already exists with this provider`);
    }

    const record = await this.prisma.dnsRecord.create({
      data: {
        domain: dto.domain,
        recordType: dto.recordType,
        providerId: dto.providerId,
        isEnabled: dto.isEnabled ?? true,
        checkInterval: dto.checkInterval ?? 300,
        description: dto.description,
        tags: dto.tags ?? [],
      },
      include: {
        provider: true,
      },
    });

    // Log activity
    await this.activityLog.create({
      category: 'DNS_RESOLUTION' as any,
      action: 'record_created',
      resourceType: 'dns_record',
      resourceId: record.id,
      resourceName: record.domain,
      title: `DNS record created: ${record.domain}`,
      description: `DNS record for ${record.domain} (${record.recordType}) created with provider ${record.provider.displayName}`,
      metadata: {
        domain: record.domain,
        recordType: record.recordType,
        provider: record.provider.displayName,
        checkInterval: record.checkInterval,
      },
    });

    return record;
  }

  async findAll(params?: {
    providerId?: string;
    isEnabled?: boolean;
    status?: string;
  }): Promise<DnsRecord[]> {
    return this.prisma.dnsRecord.findMany({
      where: {
        providerId: params?.providerId,
        isEnabled: params?.isEnabled,
        status: params?.status as any,
      },
      include: {
        provider: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<DnsRecord> {
    const record = await this.prisma.dnsRecord.findUnique({
      where: { id },
      include: {
        provider: true,
      },
    });

    if (!record) {
      throw new NotFoundException(`DNS record with ID '${id}' not found`);
    }

    return record;
  }

  async update(id: string, dto: UpdateDnsRecordDto): Promise<DnsRecord> {
    const existingRecord = await this.findOne(id);

    // If provider is being changed, validate it exists
    if (dto.providerId && dto.providerId !== existingRecord.providerId) {
      await this.dnsProviderService.findOne(dto.providerId);
    }

    const updatedRecord = await this.prisma.dnsRecord.update({
      where: { id },
      data: {
        domain: dto.domain,
        recordType: dto.recordType,
        providerId: dto.providerId,
        isEnabled: dto.isEnabled,
        checkInterval: dto.checkInterval,
        description: dto.description,
        tags: dto.tags,
      },
      include: {
        provider: true,
      },
    });

    // Log activity
    await this.activityLog.create({
      category: 'DNS_RESOLUTION' as any,
      action: 'record_updated',
      resourceType: 'dns_record',
      resourceId: updatedRecord.id,
      resourceName: updatedRecord.domain,
      title: `DNS record updated: ${updatedRecord.domain}`,
      description: `DNS record for ${updatedRecord.domain} has been updated`,
      metadata: {
        domain: updatedRecord.domain,
        recordType: updatedRecord.recordType,
        provider: updatedRecord.provider.displayName,
      },
      oldValues: {
        domain: existingRecord.domain,
        recordType: existingRecord.recordType,
        isEnabled: existingRecord.isEnabled,
        checkInterval: existingRecord.checkInterval,
      },
      newValues: {
        domain: updatedRecord.domain,
        recordType: updatedRecord.recordType,
        isEnabled: updatedRecord.isEnabled,
        checkInterval: updatedRecord.checkInterval,
      },
    });

    return updatedRecord;
  }

  async remove(id: string): Promise<void> {
    const record = await this.findOne(id);

    await this.prisma.dnsRecord.delete({
      where: { id },
    });

    // Log activity
    await this.activityLog.create({
      category: 'DNS_RESOLUTION' as any,
      action: 'record_deleted',
      resourceType: 'dns_record',
      resourceId: record.id,
      resourceName: record.domain,
      title: `DNS record deleted: ${record.domain}`,
      description: `DNS record for ${record.domain} has been deleted`,
      metadata: {
        domain: record.domain,
        recordType: record.recordType,
        provider: record.provider?.displayName || 'Unknown',
      },
    });
  }

  async resolveRecord(id: string): Promise<any> {
    return this.dnsResolutionService.resolveRecord(id);
  }

  async getRecordResolutions(id: string, limit = 100): Promise<any[]> {
    return this.dnsResolutionService.getResolutionHistory(id, limit);
  }

  async getDnsStats(): Promise<any> {
    // Get DNS settings to determine if filtering is enabled
    const settings = await this.settingsService.get();
    const isFilteringEnabled = settings.dnsSkipNonAddressRecords;

    // Define standard record types (A, AAAA, CNAME) using the enum
    const standardRecordTypes = [DnsRecordType.A, DnsRecordType.AAAA, DnsRecordType.CNAME];

    // Build where clause for filtering if enabled
    const whereClause = isFilteringEnabled
      ? { recordType: { in: standardRecordTypes } }
      : {};

    const enabledWhereClause = isFilteringEnabled
      ? { isEnabled: true, recordType: { in: standardRecordTypes } }
      : { isEnabled: true };

    const [totalRecords, enabledRecords, recentResolutions] = await Promise.all([
      this.prisma.dnsRecord.count({ where: whereClause }),
      this.prisma.dnsRecord.count({ where: enabledWhereClause }),
      this.dnsResolutionService.getRecentResolutions(24),
    ]);

    const statusCounts = await this.prisma.dnsRecord.groupBy({
      by: ['status'],
      where: whereClause,
      _count: true,
    });

    const providerCounts = await this.prisma.dnsRecord.groupBy({
      by: ['providerId'],
      where: whereClause,
      _count: true,
    });

    // Get provider details separately
    const providers = await this.prisma.dnsProvider.findMany({
      select: {
        id: true,
        displayName: true,
      },
    });

    const providerCountsWithNames = providerCounts.map(count => ({
      ...count,
      provider: providers.find(p => p.id === count.providerId),
    }));

    // Filter recent resolutions if filtering is enabled
    const filteredRecentResolutions = isFilteringEnabled
      ? recentResolutions.filter(r => {
          const record = (r as any).dnsRecord;
          return record && standardRecordTypes.includes(record.recordType);
        })
      : recentResolutions;

    return {
      totalRecords,
      enabledRecords,
      statusDistribution: statusCounts.reduce((acc: Record<string, number>, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {}),
      providerDistribution: providerCountsWithNames,
      recentResolutions: filteredRecentResolutions.length,
      last24HourSuccess: filteredRecentResolutions.filter(r => r.status === 'RESOLVED').length,
      last24HourFailures: filteredRecentResolutions.filter(r => r.status === 'FAILED').length,
      isFilteringEnabled,
      standardRecordTypes: isFilteringEnabled ? standardRecordTypes.map(t => t.toString()) : null,
    };
  }

  async findDueRecords(): Promise<DnsRecord[]> {
    const now = new Date();
    
    return this.prisma.dnsRecord.findMany({
      where: {
        isEnabled: true,
        OR: [
          { lastCheckAt: null },
          {
            lastCheckAt: {
              lt: new Date(now.getTime() - 1000 * 60), // At least 1 minute ago
            },
          },
        ],
      },
      include: {
        provider: true,
      },
    });
  }
}
