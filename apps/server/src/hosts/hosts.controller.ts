import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { HostsService, HostItem } from './hosts.service';

@Controller('/api/v1/hosts')
export class HostsController {
  constructor(private readonly hostsService: HostsService) {}

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
}

