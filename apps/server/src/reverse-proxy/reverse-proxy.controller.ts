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

  @Post('cleanup/orphaned-routes')
  @HttpCode(200)
  async cleanupOrphanedRoutes(): Promise<{ deletedCount: number }> {
    this.logger.log(`[NPM Cleanup] Manual cleanup of orphaned routes triggered`);
    return this.svc.cleanupOrphanedRoutes();
  }

  @Post('sync-and-cleanup/:hostId')
  @HttpCode(202)
  async syncAndCleanup(@Param('hostId') hostId: string) {
    this.logger.log(`[NPM Sync+Cleanup] Manual sync and cleanup triggered for host: ${hostId}`);
    this.svc.syncAndCleanup(hostId).catch(err => {
      this.logger.error(`[NPM Sync+Cleanup] Failed for host ${hostId}`, err);
    });
    return { message: `NPM route sync and cleanup initiated for host ${hostId}.` };
  }
}