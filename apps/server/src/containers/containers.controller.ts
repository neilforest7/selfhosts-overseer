import { BadRequestException, Body, Controller, Get, Param, Post, Query, Patch, NotFoundException, Delete, HttpCode } from '@nestjs/common';
import { ContainersService } from './containers.service';
import { DockerService } from './docker.service';
import { UpdateManualPortDto } from './dto/manual-port.dto';

@Controller('/api/v1/containers')
export class ContainersController {
  constructor(
    private readonly containers: ContainersService,
    private readonly docker: DockerService
  ) {}

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

  @Patch(':id/manual-port')
  async updateManualPortMapping(
    @Param('id') id: string,
    @Body() updateManualPortDto: UpdateManualPortDto,
  ) {
    const container = await this.containers.updateManualPortMapping(
      id,
      updateManualPortDto,
    );
    if (!container) {
      throw new NotFoundException(`Container with ID ${id} not found`);
    }
    return container;
  }

  @Delete(':id/manual-port')
  @HttpCode(204)
  async deleteManualPortMapping(@Param('id') id: string) {
    await this.containers.deleteManualPortMapping(id);
  }

  @Post('discover')
  async discover(@Body() body: {
    host?: { id?: string; address?: string; sshUser?: string; port?: number };
    hostIds?: string[];
  }) {
    // Support both single host and multiple hosts
    if (body.hostIds && body.hostIds.length > 0) {
      return this.containers.discoverMultiple(body.hostIds);
    }
    const hostArg = (body && body.host) ? (body.host as any) : ({ id: 'all' } as any);
    return this.containers.discover(hostArg);
  }

  @Post('check-updates')
  async checkUpdates(@Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; }) {
    return this.containers.checkUpdatesAny(body.host as any);
  }

  @Post('check-compose-updates')
  async checkComposeUpdates(@Body() body: { hostId: string; composeProject: string; }) {
    return this.containers.checkComposeProjectUpdates(body.hostId, body.composeProject);
  }

  @Post(':id/check-update')
  async checkSingleContainerUpdate(@Param('id') id: string) {
    return this.containers.checkSingleContainerUpdate(id);
  }

  @Post(':id/update')
  async updateContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; imageRef?: string; opId?: string; }) {
    return this.containers.updateOne(body.host as any, id, body.imageRef, body.opId);
  }

  @Post(':id/restart')
  async restartContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string; }) {
    return this.containers.restartOne(body.host as any, id, body.opId);
  }

  @Post(':id/start')
  async startContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string; }) {
    return this.containers.startOne(body.host as any, id, body.opId);
  }

  @Post(':id/stop')
  async stopContainer(@Param('id') id: string, @Body() body: { host: { id?: string; address?: string; sshUser?: string; port?: number }; opId?: string; }) {
    return this.containers.stopOne(body.host as any, id, body.opId);
  }

  @Post('compose/operate')
  async composeOperate(@Body() body: { hostId: string; project: string; workingDir: string; op: 'down'|'pull'|'up'|'restart'|'stop'|'start'; }) {
    return this.containers.composeOperate({ id: body.hostId }, body.op, body.project, body.workingDir);
  }

  @Post('compose/reactivate')
  async reactivateComposeProject(@Body() body: { hostId: string; project: string; workingDir: string; }) {
    return this.containers.reactivateComposeProject({ id: body.hostId }, body.project, body.workingDir);
  }

  @Get('compose/down-projects')
  async getComposeDownProjects(@Query('hostId') hostId?: string) {
    return this.containers.getComposeDownProjects(hostId);
  }

  @Post('refresh-status')
  async refreshStatus(@Body() body: { hostId: string; containerIds?: string[]; containerNames?: string[]; composeProject?: string; }) {
    return this.containers.refreshStatus(body.hostId, { containerIds: body.containerIds, containerNames: body.containerNames, composeProject: body.composeProject });
  }

  @Post('cleanup-duplicates')
  async cleanupDuplicates(@Body() _body: { hostId?: string | 'all'; }) {
    const result = await this.containers.cleanupDuplicates();
    return result;
  }

  @Post('purge')
  async purge(@Body() body: { hostId: string; }) {
    const result = await this.containers.purgeStoppedContainers({ id: body.hostId });
    return result;
  }

  @Post('test-credentials')
  async testCredentials(@Body() body: { username: string; personalAccessToken: string }) {
    try {
      // 使用本地 Docker 测试凭证
      const testHost = {
        address: '127.0.0.1',
        sshUser: 'root',
        port: 22
      };
      
      // 尝试登录 Docker Hub
      const loginCmd = `echo "${body.personalAccessToken}" | docker login --username "${body.username}" --password-stdin`;
      const { code, stderr } = await this.docker.execShell(testHost, loginCmd, { timeoutSec: 60 } as any);
      
      if (code === 0) {
        return { success: true, message: 'Docker Hub 登录成功' };
      } else {
        throw new BadRequestException(`登录失败: ${stderr}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`测试失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}