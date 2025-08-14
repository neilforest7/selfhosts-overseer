import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ContainersService } from './containers.service';

@Controller('/api/v1/containers')
export class ContainersController {
  constructor(private readonly containers: ContainersService) {}

  @Get()
  async list(
    @Query('hostId') hostId?: string,
    @Query('hostName') hostName?: string,
    @Query('q') q?: string,
    @Query('updateAvailable') updateAvailable?: string,
    @Query('composeManaged') composeManaged?: string
  ) {
    return this.containers.list({
      hostId,
      hostName,
      q,
      updateAvailable: updateAvailable === 'true' ? true : updateAvailable === 'false' ? false : undefined,
      isComposeManaged: composeManaged === 'true' ? true : composeManaged === 'false' ? false : undefined,
    });
  }

  @Post('discover')
  async discover(@Body() body: { host?: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string }) {
    const hostArg = (body && body.host) ? (body.host as any) : ({ id: 'all' } as any);
    return this.containers.discover(hostArg, body.opId);
  }

  @Post('check-updates')
  async checkUpdates(@Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string }) {
    return this.containers.checkUpdatesAny(body.host as any, body.opId);
  }

  @Post(':id/update')
  async updateContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; imageRef?: string; opId?: string }) {
    return this.containers.updateOne(body.host as any, id, body.imageRef, body.opId);
  }

  @Post(':id/restart')
  async restartContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string }) {
    return this.containers.restartOne(body.host as any, id, body.opId);
  }

  @Post(':id/start')
  async startContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string }) {
    return this.containers.startOne(body.host as any, id, body.opId);
  }

  @Post(':id/stop')
  async stopContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string }) {
    return this.containers.stopOne(body.host as any, id, body.opId);
  }

  @Post('compose/operate')
  async composeOperate(@Body() body: { hostId: string; project: string; workingDir: string; op: 'down'|'pull'|'up'|'restart'|'start'|'stop'; opId?: string }) {
    return this.containers.composeOperate(body.hostId, body.project, body.workingDir, body.op, body.opId);
  }

  @Post('refresh-status')
  async refreshStatus(@Body() body: { hostId: string; containerIds?: string[]; containerNames?: string[]; composeProject?: string; opId?: string }) {
    return this.containers.refreshStatus(body.hostId, { containerIds: body.containerIds, containerNames: body.containerNames, composeProject: body.composeProject }, body.opId);
  }

  @Post('cleanup-duplicates')
  async cleanupDuplicates(@Body() body: { hostId?: string | 'all'; opId?: string }) {
    const removed = await this.containers.cleanupDuplicates(body.hostId, body.opId);
    return { removed };
  }

  @Post('purge')
  async purge(@Body() body: { hostId?: string | 'all'; opId?: string }) {
    const removed = await this.containers.purgeContainers(body.hostId, body.opId);
    return { removed };
  }
}

