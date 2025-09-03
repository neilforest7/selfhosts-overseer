  import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import { DnsService } from './dns.service';
import { DnsProviderService } from './dns-provider.service';
import { DnsResolutionService } from './dns-resolution.service';
import { DnsProcessor } from './dns.processor';
import { DnsDiscoveryService } from './dns-discovery.service';
import { CreateDnsProviderDto } from './dto/create-dns-provider.dto';
import { CreateDnsRecordDto, UpdateDnsRecordDto } from './dto/create-dns-record.dto';

@Controller('api/v1/dns')
export class DnsController {
  constructor(
    private readonly dnsService: DnsService,
    private readonly dnsProviderService: DnsProviderService,
    private readonly dnsResolutionService: DnsResolutionService,
    private readonly dnsProcessor: DnsProcessor,
    private readonly dnsDiscoveryService: DnsDiscoveryService,
  ) {}

  // DNS Provider Management
  @Get('providers')
  async getProviders() {
    return this.dnsProviderService.findAll();
  }

  @Get('providers/available')
  async getAvailableProviders() {
    return this.dnsProviderService.getAvailableProviders();
  }

  @Get('providers/:id')
  async getProvider(@Param('id') id: string) {
    return this.dnsProviderService.findOne(id);
  }

  @Post('providers')
  async createProvider(@Body(ValidationPipe) dto: CreateDnsProviderDto) {
    return this.dnsProviderService.createProvider(dto);
  }

  @Put('providers/:id')
  async updateProvider(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: Partial<CreateDnsProviderDto>,
  ) {
    return this.dnsProviderService.update(id, dto);
  }

  @Delete('providers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProvider(@Param('id') id: string) {
    await this.dnsProviderService.remove(id);
  }

  @Post('providers/:id/test')
  async testProvider(@Param('id') id: string) {
    const isConnected = await this.dnsProviderService.testConnection(id);
    return { connected: isConnected };
  }

  @Post('providers/:id/discover')
  async discoverRecords(
    @Param('id') id: string,
    @Body() body: {
      importRecords?: boolean;
      recordTypes?: string[];
      skipExisting?: boolean;
      updateExisting?: boolean;
    } = {},
  ) {
    const options = {
      importRecords: body.importRecords ?? false,
      recordTypes: body.recordTypes as any[],
      skipExisting: body.skipExisting ?? true,
      updateExisting: body.updateExisting ?? false,
    };

    const result = await this.dnsDiscoveryService.discoverRecords(id, options);
    return result;
  }

  @Get('providers/:id/discovery-stats')
  async getDiscoveryStats(@Param('id') id: string) {
    return this.dnsDiscoveryService.getDiscoveryStats(id);
  }

  // DNS Record Management
  @Get('records')
  async getRecords(
    @Query('providerId') providerId?: string,
    @Query('isEnabled') isEnabled?: string,
    @Query('status') status?: string,
  ) {
    return this.dnsService.findAll({
      providerId,
      isEnabled: isEnabled ? isEnabled === 'true' : undefined,
      status,
    });
  }

  @Get('records/:id')
  async getRecord(@Param('id') id: string) {
    return this.dnsService.findOne(id);
  }

  @Post('records')
  async createRecord(@Body(ValidationPipe) dto: CreateDnsRecordDto) {
    return this.dnsService.createRecord(dto);
  }

  @Put('records/:id')
  async updateRecord(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: UpdateDnsRecordDto,
  ) {
    return this.dnsService.update(id, dto);
  }

  @Delete('records/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRecord(@Param('id') id: string) {
    await this.dnsService.remove(id);
  }

  @Post('records/:id/resolve')
  async resolveRecord(@Param('id') id: string) {
    await this.dnsProcessor.triggerResolution(id);
    return { message: 'DNS resolution triggered' };
  }

  @Post('records/batch-resolve')
  async batchResolveRecords(
    @Body() body: { recordIds: string[]; batchSize?: number },
  ) {
    await this.dnsProcessor.triggerBatchResolution(body.recordIds, body.batchSize);
    return { message: 'Batch DNS resolution triggered' };
  }

  // DNS Resolution History
  @Get('records/:id/resolutions')
  async getRecordResolutions(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    return this.dnsService.getRecordResolutions(id, limitNum);
  }

  @Get('resolutions')
  async getResolutions(@Query('hours') hours?: string) {
    const hoursNum = hours ? parseInt(hours, 10) : 24;
    return this.dnsResolutionService.getRecentResolutions(hoursNum);
  }

  // DNS Statistics and Monitoring
  @Get('stats')
  async getDnsStats() {
    return this.dnsService.getDnsStats();
  }

  @Get('health')
  async getHealth() {
    const stats = await this.dnsService.getDnsStats();
    const dueRecords = await this.dnsService.findDueRecords();
    
    return {
      status: 'healthy',
      totalRecords: stats.totalRecords,
      enabledRecords: stats.enabledRecords,
      recordsDue: dueRecords.length,
      last24HourSuccess: stats.last24HourSuccess,
      last24HourFailures: stats.last24HourFailures,
      timestamp: new Date().toISOString(),
    };
  }

  // Maintenance Operations
  @Post('cleanup')
  async cleanupResolutions(@Query('retentionDays') retentionDays?: string) {
    const days = retentionDays ? parseInt(retentionDays, 10) : 30;
    const deletedCount = await this.dnsResolutionService.cleanupOldResolutions(days);
    return { deletedCount, message: `Cleaned up ${deletedCount} old resolution records` };
  }
}
