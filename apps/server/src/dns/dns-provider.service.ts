import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { CloudflareProvider } from './providers/cloudflare-provider';
import { DnsOverHttpsProvider } from './providers/dns-over-https-provider';
import { BaseDnsProvider, DnsProviderConfig } from './interfaces/dns-provider.interface';
import { CreateDnsProviderDto } from './dto/create-dns-provider.dto';
import { DnsProvider } from '@prisma/client';

@Injectable()
export class DnsProviderService {
  private readonly logger = new Logger(DnsProviderService.name);
  private readonly providers = new Map<string, BaseDnsProvider>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly cloudflareProvider: CloudflareProvider,
    private readonly dnsOverHttpsProvider: DnsOverHttpsProvider,
  ) {
    this.registerProviders();
  }

  private registerProviders() {
    this.providers.set(this.cloudflareProvider.name, this.cloudflareProvider);
    this.providers.set(this.dnsOverHttpsProvider.name, this.dnsOverHttpsProvider);
  }

  getAvailableProviders(): Array<{ name: string; displayName: string }> {
    return Array.from(this.providers.values()).map(provider => ({
      name: provider.name,
      displayName: provider.displayName,
    }));
  }

  getProvider(name: string): BaseDnsProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new NotFoundException(`DNS provider '${name}' not found`);
    }
    return provider;
  }

  async createProvider(dto: CreateDnsProviderDto): Promise<DnsProvider> {
    // Validate that the provider type exists
    const providerImpl = this.getProvider(dto.name);

    // Validate the configuration
    try {
      const isValidConfig = await providerImpl.validateConfig(dto.apiConfig);
      if (!isValidConfig) {
        throw new BadRequestException('Invalid API configuration for DNS provider');
      }
    } catch (error) {
      // Provide more specific error messages based on the provider response
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage && errorMessage.includes('Invalid format for X-Auth-Key header')) {
        throw new BadRequestException('Invalid Cloudflare Global API Key format. Please ensure you are using a Global API Key, not an API Token.');
      } else if (errorMessage && errorMessage.includes('Invalid request headers')) {
        throw new BadRequestException('Invalid Cloudflare API credentials. Please check your email and Global API Key.');
      } else if (errorMessage && errorMessage.includes('status code 400')) {
        throw new BadRequestException('Invalid Cloudflare API configuration. Please verify your email and Global API Key are correct.');
      }
      throw new BadRequestException(`DNS provider validation failed: ${errorMessage || 'Invalid API configuration'}`);
    }

    // Encrypt the API configuration
    const encryptedConfig = this.crypto.encryptString(JSON.stringify(dto.apiConfig)) || '{}';

    return this.prisma.dnsProvider.create({
      data: {
        name: dto.name,
        displayName: dto.displayName,
        isEnabled: dto.isEnabled ?? true,
        apiConfig: encryptedConfig,
        rateLimitPerMinute: dto.rateLimitPerMinute ?? providerImpl.getRateLimit().perMinute,
        timeoutSeconds: dto.timeoutSeconds ?? providerImpl.getRateLimit().timeout,
      },
    });
  }

  async findAll(): Promise<DnsProvider[]> {
    return this.prisma.dnsProvider.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<DnsProvider> {
    const provider = await this.prisma.dnsProvider.findUnique({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`DNS provider with ID '${id}' not found`);
    }

    return provider;
  }

  async update(id: string, updateData: Partial<CreateDnsProviderDto>): Promise<DnsProvider> {
    const existingProvider = await this.findOne(id);
    
    let encryptedConfig = existingProvider.apiConfig;
    
    if (updateData.apiConfig) {
      // Validate the new configuration if provided
      const providerImpl = this.getProvider(existingProvider.name);
      const isValidConfig = await providerImpl.validateConfig(updateData.apiConfig);
      if (!isValidConfig) {
        throw new BadRequestException('Invalid API configuration for DNS provider');
      }
      
      encryptedConfig = this.crypto.encryptString(JSON.stringify(updateData.apiConfig)) || '{}';
    }

    return this.prisma.dnsProvider.update({
      where: { id },
      data: {
        displayName: updateData.displayName,
        isEnabled: updateData.isEnabled,
        apiConfig: encryptedConfig as any,
        rateLimitPerMinute: updateData.rateLimitPerMinute,
        timeoutSeconds: updateData.timeoutSeconds,
      },
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id); // Ensure it exists
    await this.prisma.dnsProvider.delete({
      where: { id },
    });
  }

  async testConnection(id: string): Promise<boolean> {
    const provider = await this.findOne(id);
    const providerImpl = this.getProvider(provider.name);
    
    // Decrypt the configuration
    const decryptedConfigStr = this.crypto.decryptString(provider.apiConfig as string);
    const decryptedConfig = decryptedConfigStr ? JSON.parse(decryptedConfigStr) as DnsProviderConfig : {};
    
    return providerImpl.testConnection(decryptedConfig);
  }

  async getDecryptedConfig(providerId: string): Promise<DnsProviderConfig> {
    const provider = await this.findOne(providerId);
    const decryptedConfigStr = this.crypto.decryptString(provider.apiConfig as string);
    return decryptedConfigStr ? JSON.parse(decryptedConfigStr) as DnsProviderConfig : {};
  }
}
