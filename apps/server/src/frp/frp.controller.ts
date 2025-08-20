import { Controller, Get, Post, Param } from '@nestjs/common';
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
}
