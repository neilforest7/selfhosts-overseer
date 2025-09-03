import { DnsRecordType, DnsStatus } from '@prisma/client';

export interface DnsResolutionResult {
  domain: string;
  recordType: DnsRecordType;
  resolvedIp?: string;
  responseTime: number;
  status: DnsStatus;
  errorMessage?: string;
  geoLocation?: {
    country?: string;
    city?: string;
    isp?: string;
    latitude?: number;
    longitude?: number;
  };
}

export interface DnsProviderConfig {
  apiKey?: string;
  apiSecret?: string;
  endpoint?: string;
  region?: string;
  [key: string]: any;
}

export interface DnsProviderRateLimit {
  perMinute: number;
  timeout: number;
}

export abstract class BaseDnsProvider {
  abstract readonly name: string;
  abstract readonly displayName: string;

  abstract validateConfig(config: DnsProviderConfig): Promise<boolean>;
  abstract resolveRecord(domain: string, recordType: DnsRecordType): Promise<DnsResolutionResult>;
  abstract getRateLimit(): DnsProviderRateLimit;
  abstract testConnection(config: DnsProviderConfig): Promise<boolean>;
}
