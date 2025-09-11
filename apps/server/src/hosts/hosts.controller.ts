import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { HostsService, HostItem } from './hosts.service';
import { ConnectivityService } from './connectivity.service';
import { AuthGuard } from '../auth/auth.guard';
import { Public } from '../auth/auth.guard';

@Controller('/api/v1/hosts')
@UseGuards(AuthGuard)
export class HostsController {
  constructor(
    private readonly hostsService: HostsService,
    private readonly connectivityService: ConnectivityService,
  ) {}

  @Get()
  async list(
    @Query('tag') tag?: string,
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string
  ): Promise<{ items: HostItem[]; nextCursor: string | null }> {
    return this.hostsService.list(tag, Number(limitStr), cursor);
  }

  @Post()
  async add(@Body() host: HostItem): Promise<HostItem> {
    return this.hostsService.add(host);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() partial: Partial<HostItem>): Promise<HostItem> {
    return this.hostsService.update(id, partial);
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.hostsService.remove(id);
    return { ok: true };
  }

  @Post(':id/test-connection')
  async test(@Param('id') id: string) {
    return this.hostsService.testConnection(id);
  }

  @Post('cleanup/orphaned-routes')
  async cleanupOrphanedRoutes(): Promise<{ deletedCount: number }> {
    return this.hostsService.cleanupOrphanedReverseProxyRoutes();
  }

  @Get(':id/connectivity')
  async getConnectivity(@Param('id') id: string, @Query('limit') limitStr?: string) {
    const limit = limitStr ? parseInt(limitStr, 10) : 100;
    return this.connectivityService.getHostConnectivityHistory(id, limit);
  }

  @Post(':id/check-connectivity')
  async checkConnectivity(@Param('id') id: string) {
    return this.connectivityService.checkHostConnectivity(id);
  }

  @Post('check-all-connectivity')
  async checkAllConnectivity() {
    return this.connectivityService.checkAllHostsConnectivity();
  }

  @Get('connectivity/stats')
  async getConnectivityStats() {
    return this.connectivityService.getConnectivityStats();
  }
}

