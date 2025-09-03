import { Injectable, Logger } from '@nestjs/common';
import { DnsRecordType, DnsStatus } from '@prisma/client';
import { BaseDnsProvider, DnsProviderConfig, DnsResolutionResult, DnsProviderRateLimit } from '../interfaces/dns-provider.interface';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class DnsOverHttpsProvider extends BaseDnsProvider {
  private readonly logger = new Logger(DnsOverHttpsProvider.name);
  readonly name = 'dns-over-https';
  readonly displayName = 'DNS over HTTPS (Generic)';
  private axiosInstance: AxiosInstance;

  constructor() {
    super();
    this.axiosInstance = axios.create({
      timeout: 30000,
      headers: {
        'Accept': 'application/dns-json',
      },
    });
  }

  async validateConfig(config: DnsProviderConfig): Promise<boolean> {
    try {
      if (!config.endpoint) {
        return false;
      }

      // Test with a simple query
      const response = await this.axiosInstance.get(config.endpoint, {
        params: {
          name: 'google.com',
          type: 'A',
        },
      });

      return response.data && typeof response.data.Status === 'number';
    } catch (error) {
      this.logger.error(`DNS over HTTPS config validation failed: ${error.message}`);
      return false;
    }
  }

  async testConnection(config: DnsProviderConfig): Promise<boolean> {
    return this.validateConfig(config);
  }

  async resolveRecord(domain: string, recordType: DnsRecordType): Promise<DnsResolutionResult> {
    const startTime = Date.now();
    
    try {
      // Default to Cloudflare's DNS over HTTPS if no endpoint specified
      const endpoint = 'https://cloudflare-dns.com/dns-query';
      
      const response = await this.axiosInstance.get(endpoint, {
        params: {
          name: domain,
          type: recordType,
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
      this.logger.error(`DNS resolution failed for ${domain}: ${error.message}`);
      
      return {
        domain,
        recordType,
        responseTime,
        status: error.code === 'ECONNABORTED' ? DnsStatus.TIMEOUT : DnsStatus.FAILED,
        errorMessage: error.message,
      };
    }
  }

  getRateLimit(): DnsProviderRateLimit {
    return {
      perMinute: 600, // Conservative rate limit for generic DoH
      timeout: 30,
    };
  }
}
