import { Injectable, Logger } from '@nestjs/common';
import { DnsRecordType, DnsStatus } from '@prisma/client';
import { BaseDnsProvider, DnsProviderConfig, DnsResolutionResult, DnsProviderRateLimit } from '../interfaces/dns-provider.interface';
import axios, { AxiosInstance } from 'axios';

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  type: string;
  development_mode: number;
  name_servers: string[];
  original_name_servers: string[];
  original_registrar: string;
  original_dnshost: string;
  modified_on: string;
  created_on: string;
  activated_on: string;
  meta: {
    step: number;
    wildcard_proxiable: boolean;
    custom_certificate_quota: number;
    page_rule_quota: number;
    phishing_detected: boolean;
    multiple_railguns_allowed: boolean;
  };
  owner: {
    id: string;
    type: string;
    email: string;
  };
  account: {
    id: string;
    name: string;
  };
  tenant: {
    id: string;
    name: string;
  };
  tenant_unit: {
    id: string;
  };
  permissions: string[];
  plan: {
    id: string;
    name: string;
    price: number;
    currency: string;
    frequency: string;
    is_subscribed: boolean;
    can_subscribe: boolean;
    legacy_id: string;
    legacy_discount: boolean;
    externally_managed: boolean;
  };
}

export interface CloudflareDnsRecord {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;
  type: string;
  content: string;
  proxiable: boolean;
  proxied: boolean;
  ttl: number;
  locked: boolean;
  meta: {
    auto_added: boolean;
    managed_by_apps: boolean;
    managed_by_argo_tunnel: boolean;
    source: string;
  };
  comment?: string;
  tags: string[];
  created_on: string;
  modified_on: string;
  priority?: number;
  data?: any;
}

export interface CloudflareApiResponse<T> {
  success: boolean;
  errors: Array<{
    code: number;
    message: string;
  }>;
  messages: Array<{
    code: number;
    message: string;
  }>;
  result: T;
  result_info?: {
    page: number;
    per_page: number;
    count: number;
    total_count: number;
    total_pages: number;
  };
}

export interface DiscoveryProgress {
  stage: 'zones' | 'records' | 'complete';
  zonesFound: number;
  recordsFound: number;
  currentZone?: string;
  totalZones?: number;
  processedZones?: number;
}

@Injectable()
export class CloudflareProvider extends BaseDnsProvider {
  private readonly logger = new Logger(CloudflareProvider.name);
  readonly name = 'cloudflare';
  readonly displayName = 'Cloudflare';
  private axiosInstance: AxiosInstance;

  constructor() {
    super();
    this.axiosInstance = axios.create({
      baseURL: 'https://api.cloudflare.com/client/v4',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async validateConfig(config: DnsProviderConfig): Promise<boolean> {
    try {
      if (!config.apiKey || !config.email) {
        return false;
      }

      // Use /user endpoint for Global API Key validation
      // The /user/tokens/verify endpoint is only for API Tokens, not Global API Keys
      const response = await this.axiosInstance.get('/user', {
        headers: {
          'X-Auth-Email': config.email,
          'X-Auth-Key': config.apiKey,
        },
      });

      return response.data.success === true;
    } catch (error) {
      if ((error as any)?.response) {
        this.logger.error(`Cloudflare config validation failed: ${(error as any).response.status} - ${JSON.stringify((error as any).response.data)}`);
      } else {
        this.logger.error(`Cloudflare config validation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return false;
    }
  }

  async testConnection(config: DnsProviderConfig): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/user', {
        headers: {
          'X-Auth-Email': config.email,
          'X-Auth-Key': config.apiKey,
        },
      });

      return response.data.success === true;
    } catch (error) {
      this.logger.error(`Cloudflare connection test failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async resolveRecord(domain: string, recordType: DnsRecordType): Promise<DnsResolutionResult> {
    const startTime = Date.now();
    
    try {
      // Use Cloudflare's DNS over HTTPS API for resolution
      const response = await this.axiosInstance.get(`https://cloudflare-dns.com/dns-query`, {
        params: {
          name: domain,
          type: recordType,
        },
        headers: {
          'Accept': 'application/dns-json',
        },
      });

      const responseTime = Date.now() - startTime;

      if (response.data.Status === 0 && response.data.Answer && response.data.Answer.length > 0) {
        const answer = response.data.Answer[0];
        return {
          domain,
          recordType,
          resolvedIp: answer.data,
          responseTime,
          status: DnsStatus.RESOLVED,
        };
      } else {
        return {
          domain,
          recordType,
          responseTime,
          status: DnsStatus.NO_RECORD,
          errorMessage: 'No DNS record found',
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`DNS resolution failed for ${domain}: ${errorMessage}`);

      return {
        domain,
        recordType,
        responseTime,
        status: (error as any)?.code === 'ECONNABORTED' ? DnsStatus.TIMEOUT : DnsStatus.FAILED,
        errorMessage,
      };
    }
  }

  getRateLimit(): DnsProviderRateLimit {
    return {
      perMinute: 1200, // Cloudflare allows 1200 requests per 5 minutes
      timeout: 30,
    };
  }

  /**
   * Discover all zones (domains) in the Cloudflare account
   */
  async discoverZones(config: DnsProviderConfig): Promise<CloudflareZone[]> {
    try {
      const zones: CloudflareZone[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await this.axiosInstance.get<CloudflareApiResponse<CloudflareZone[]>>('/zones', {
          headers: {
            'X-Auth-Email': config.email,
            'X-Auth-Key': config.apiKey,
          },
          params: {
            page,
            per_page: 50, // Maximum allowed by Cloudflare
          },
        });

        if (!response.data.success) {
          throw new Error(`Cloudflare API error: ${response.data.errors.map((e: any) => e.message).join(', ')}`);
        }

        zones.push(...response.data.result);

        // Check if there are more pages
        const resultInfo = response.data.result_info;
        hasMore = resultInfo ? page < resultInfo.total_pages : false;
        page++;
      }

      this.logger.log(`Discovered ${zones.length} zones in Cloudflare account`);
      return zones;
    } catch (error) {
      this.logger.error(`Failed to discover Cloudflare zones: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Discover all DNS records for a specific zone
   */
  async discoverRecordsForZone(config: DnsProviderConfig, zoneId: string): Promise<CloudflareDnsRecord[]> {
    try {
      const records: CloudflareDnsRecord[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const response = await this.axiosInstance.get<CloudflareApiResponse<CloudflareDnsRecord[]>>(`/zones/${zoneId}/dns_records`, {
          headers: {
            'X-Auth-Email': config.email,
            'X-Auth-Key': config.apiKey,
          },
          params: {
            page,
            per_page: 100, // Maximum allowed by Cloudflare
          },
        });

        if (!response.data.success) {
          throw new Error(`Cloudflare API error: ${response.data.errors.map((e: any) => e.message).join(', ')}`);
        }

        records.push(...response.data.result);

        // Check if there are more pages
        const resultInfo = response.data.result_info;
        hasMore = resultInfo ? page < resultInfo.total_pages : false;
        page++;
      }

      this.logger.log(`Discovered ${records.length} DNS records for zone ${zoneId}`);
      return records;
    } catch (error) {
      this.logger.error(`Failed to discover DNS records for zone ${zoneId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Discover all DNS records across all zones in the account
   */
  async discoverAllRecords(config: DnsProviderConfig, progressCallback?: (progress: DiscoveryProgress) => void): Promise<{
    zones: CloudflareZone[];
    records: CloudflareDnsRecord[];
  }> {
    try {
      // First, discover all zones
      progressCallback?.({ stage: 'zones', zonesFound: 0, recordsFound: 0 });
      const zones = await this.discoverZones(config);

      progressCallback?.({ stage: 'zones', zonesFound: zones.length, recordsFound: 0 });

      // Then, discover records for each zone
      const allRecords: CloudflareDnsRecord[] = [];
      let processedZones = 0;

      for (const zone of zones) {
        progressCallback?.({
          stage: 'records',
          zonesFound: zones.length,
          recordsFound: allRecords.length,
          currentZone: zone.name,
          totalZones: zones.length,
          processedZones,
        });

        const zoneRecords = await this.discoverRecordsForZone(config, zone.id);
        allRecords.push(...zoneRecords);
        processedZones++;

        // Add a small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      progressCallback?.({
        stage: 'complete',
        zonesFound: zones.length,
        recordsFound: allRecords.length,
        totalZones: zones.length,
        processedZones,
      });

      this.logger.log(`Discovery complete: ${zones.length} zones, ${allRecords.length} total DNS records`);

      return {
        zones,
        records: allRecords,
      };
    } catch (error) {
      this.logger.error(`Failed to discover Cloudflare records: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Convert Cloudflare record type to our DnsRecordType enum
   */
  mapCloudflareRecordType(cfType: string): DnsRecordType {
    const typeMap: Record<string, DnsRecordType> = {
      'A': DnsRecordType.A,
      'AAAA': DnsRecordType.AAAA,
      'CNAME': DnsRecordType.CNAME,
      'MX': DnsRecordType.MX,
      'TXT': DnsRecordType.TXT,
      'NS': DnsRecordType.NS,
      'PTR': DnsRecordType.PTR,
      'SRV': DnsRecordType.SRV,
      'CAA': DnsRecordType.CAA,
    };

    return typeMap[cfType.toUpperCase()] || DnsRecordType.A;
  }
}
