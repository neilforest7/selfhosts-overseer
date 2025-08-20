import { Controller, Get, Query, Post, Param, HttpCode, Logger } from '@nestjs/common';
import { ReverseProxyService } from './reverse-proxy.service';

@Controller('/api/v1/reverse-proxy')
export class ReverseProxyController {
  private readonly logger = new Logger(ReverseProxyController.name);

  constructor(private readonly svc: ReverseProxyService) {}

  @Get('routes')
  async list(@Query('hostId') hostId?: string) {
    return this.svc.listRoutes({ hostId });
  }

  @Post('sync/:hostId')
  @HttpCode(202)
  async sync(@Param('hostId') hostId: string) {
    this.logger.log(`[NPM Sync] Manual sync triggered for host: ${hostId}`);
    this.svc.syncRoutesFromHost(hostId).catch(err => {
      this.logger.error(`[NPM Sync] Manual sync failed for host ${hostId}`, err);
    });
    return { message: `NPM route sync initiated for host ${hostId}.` };
  }
}