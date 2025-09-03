import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { CloudflareProvider, CloudflareZone, CloudflareDnsRecord, DiscoveryProgress } from './providers/cloudflare-provider';
import { DnsProviderConfig } from './interfaces/dns-provider.interface';
import { DnsProvider, DnsRecord, DnsRecordType } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface DiscoveryResult {
  providerId: string;
  zonesDiscovered: number;
  recordsDiscovered: number;
  recordsImported: number;
  recordsSkipped: number;
  recordsUpdated: number;
  errors: string[];
  zones: Array<{
    id: string;
    name: string;
    recordCount: number;
  }>;
}

export interface DiscoveryOptions {
  importRecords?: boolean;
  recordTypes?: DnsRecordType[];
  skipExisting?: boolean;
  updateExisting?: boolean;
}

@Injectable()
export class DnsDiscoveryService {
  private readonly logger = new Logger(DnsDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly cloudflareProvider: CloudflareProvider,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Discover DNS records for a Cloudflare provider
   */
  async discoverRecords(
    providerId: string,
    options: DiscoveryOptions = {},
    progressCallback?: (progress: DiscoveryProgress) => void,
  ): Promise<DiscoveryResult> {
    const provider = await this.prisma.dnsProvider.findUnique({
      where: { id: providerId },
    });

    if (!provider) {
      throw new NotFoundException(`DNS provider with ID ${providerId} not found`);
    }

    if (provider.name !== 'cloudflare') {
      throw new BadRequestException('DNS discovery is currently only supported for Cloudflare providers');
    }

    // Decrypt API configuration
    const decryptedConfig = this.crypto.decryptString(provider.apiConfig as string);
    if (!decryptedConfig) {
      throw new BadRequestException('Failed to decrypt provider API configuration');
    }

    const config: DnsProviderConfig = JSON.parse(decryptedConfig);

    try {
      this.logger.log(`Starting DNS discovery for provider ${provider.displayName} (${providerId})`);

      // Emit discovery started event
      this.eventEmitter.emit('dns.discovery.started', {
        providerId,
        providerName: provider.displayName,
      });

      // Discover all records from Cloudflare
      const discovery = await this.cloudflareProvider.discoverAllRecords(config, progressCallback);

      const result: DiscoveryResult = {
        providerId,
        zonesDiscovered: discovery.zones.length,
        recordsDiscovered: discovery.records.length,
        recordsImported: 0,
        recordsSkipped: 0,
        recordsUpdated: 0,
        errors: [],
        zones: discovery.zones.map(zone => ({
          id: zone.id,
          name: zone.name,
          recordCount: discovery.records.filter(r => r.zone_id === zone.id).length,
        })),
      };

      // Import records if requested
      if (options.importRecords) {
        await this.importDiscoveredRecords(
          provider,
          discovery.zones,
          discovery.records,
          options,
          result,
        );
      }

      this.logger.log(`DNS discovery completed for provider ${provider.displayName}: ${result.zonesDiscovered} zones, ${result.recordsDiscovered} records discovered, ${result.recordsImported} imported`);

      // Emit discovery completed event
      this.eventEmitter.emit('dns.discovery.completed', {
        providerId,
        providerName: provider.displayName,
        result,
      });

      return result;
    } catch (error) {
      this.logger.error(`DNS discovery failed for provider ${providerId}: ${error instanceof Error ? error.message : String(error)}`);
      
      // Emit discovery failed event
      this.eventEmitter.emit('dns.discovery.failed', {
        providerId,
        providerName: provider.displayName,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * Import discovered records into the database
   */
  private async importDiscoveredRecords(
    provider: DnsProvider,
    zones: CloudflareZone[],
    records: CloudflareDnsRecord[],
    options: DiscoveryOptions,
    result: DiscoveryResult,
  ): Promise<void> {
    const { recordTypes, skipExisting = true, updateExisting = false } = options;

    for (const record of records) {
      try {
        // Filter by record type if specified
        const mappedType = this.cloudflareProvider.mapCloudflareRecordType(record.type);
        if (recordTypes && !recordTypes.includes(mappedType)) {
          result.recordsSkipped++;
          continue;
        }

        // Check if record already exists
        const existingRecord = await this.prisma.dnsRecord.findUnique({
          where: {
            domain_providerId: {
              domain: record.name,
              providerId: provider.id,
            },
          },
        });

        if (existingRecord) {
          if (skipExisting && !updateExisting) {
            result.recordsSkipped++;
            continue;
          }

          if (updateExisting) {
            // Update existing record with Cloudflare metadata
            await this.prisma.dnsRecord.update({
              where: { id: existingRecord.id },
              data: {
                recordType: mappedType,
                cloudflareRecordId: record.id,
                cloudflareZoneId: record.zone_id,
                cloudflareZoneName: record.zone_name,
                ttl: record.ttl,
                proxied: record.proxied,
                content: record.content,
                priority: record.priority,
                comment: record.comment,
                isDiscovered: true,
                lastSyncAt: new Date(),
                providerCreatedAt: new Date(record.created_on),
                providerModifiedAt: new Date(record.modified_on),
                updatedAt: new Date(),
              },
            });
            result.recordsUpdated++;
          } else {
            result.recordsSkipped++;
          }
          continue;
        }

        // Create new record
        await this.prisma.dnsRecord.create({
          data: {
            domain: record.name,
            recordType: mappedType,
            providerId: provider.id,
            cloudflareRecordId: record.id,
            cloudflareZoneId: record.zone_id,
            cloudflareZoneName: record.zone_name,
            ttl: record.ttl,
            proxied: record.proxied,
            content: record.content,
            priority: record.priority,
            comment: record.comment,
            isDiscovered: true,
            lastSyncAt: new Date(),
            providerCreatedAt: new Date(record.created_on),
            providerModifiedAt: new Date(record.modified_on),
            isEnabled: true,
            checkInterval: 300,
            tags: record.tags || [],
          },
        });

        result.recordsImported++;
      } catch (error) {
        const errorMessage = `Failed to import record ${record.name}: ${error instanceof Error ? error.message : String(error)}`;
        this.logger.error(errorMessage);
        result.errors.push(errorMessage);
      }
    }
  }

  /**
   * Get discovery statistics for a provider
   */
  async getDiscoveryStats(providerId: string): Promise<{
    totalRecords: number;
    discoveredRecords: number;
    lastSyncAt?: Date;
    zones: Array<{
      name: string;
      recordCount: number;
    }>;
  }> {
    const [totalRecords, discoveredRecords, zoneStats] = await Promise.all([
      this.prisma.dnsRecord.count({
        where: { providerId },
      }),
      this.prisma.dnsRecord.count({
        where: { providerId, isDiscovered: true },
      }),
      this.prisma.dnsRecord.groupBy({
        by: ['cloudflareZoneName'],
        where: { providerId, isDiscovered: true },
        _count: true,
      }),
    ]);

    const lastSyncRecord = await this.prisma.dnsRecord.findFirst({
      where: { providerId, isDiscovered: true },
      orderBy: { lastSyncAt: 'desc' },
      select: { lastSyncAt: true },
    });

    return {
      totalRecords,
      discoveredRecords,
      lastSyncAt: lastSyncRecord?.lastSyncAt || undefined,
      zones: zoneStats
        .filter(stat => stat.cloudflareZoneName)
        .map(stat => ({
          name: stat.cloudflareZoneName!,
          recordCount: stat._count,
        })),
    };
  }
}
