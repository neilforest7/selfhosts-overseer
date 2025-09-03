import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { FrpService } from './frp.service';
import { HttpCode } from '@nestjs/common';

@Controller('api/v1/frp')
export class FrpController {
  constructor(private readonly frpService: FrpService) {}

  @Get('configs')
  async getFrpConfigs() {
    return this.frpService.getFrpConfigs();
  }

  @Post('sync/:hostId')
  @HttpCode(202)
  async syncFrpFromHost(@Param('hostId') hostId: string) {
    // This is a long-running task, so we don't await it.
    // The client will be notified of the result via other means (e.g., websockets or polling).
    this.frpService.syncFrpFromHost(hostId);
    return { message: `FRP sync initiated for host ${hostId}` };
  }

  @Post('resolve-dependencies')
  @HttpCode(202)
  async resolveFrpDependencies() {
    // Manually trigger FRP dependency resolution
    const result = await this.frpService.resolveFrpDependencies();
    return {
      message: 'FRP dependency resolution completed',
      result
    };
  }

  @Get('health')
  async getFrpTopologyHealth() {
    return this.frpService.validateFrpTopology();
  }

  @Post('heal')
  @HttpCode(202)
  async healFrpRelationships() {
    // Manually trigger FRP relationship healing
    this.frpService.healFrpRelationships();
    return { message: 'FRP relationship healing initiated' };
  }

  @Get('metrics')
  async getFrpSyncMetrics() {
    return this.frpService.getFrpSyncMetrics();
  }

  @Get('logs')
  async getFrpSyncLogs(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.frpService.getFrpSyncLogs(limitNum);
  }
}
