import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Patch, NotFoundException, Delete, HttpCode } from '@nestjs/common';
import { ContainersService } from './containers.service';
import { DockerService } from './docker.service';
import { DockerRegistryService } from './docker-registry.service';
import { UpdateManualPortDto } from './dto/manual-port.dto';

@Controller('/api/v1/containers')
export class ContainersController {
  constructor(
    private readonly containers: ContainersService,
    private readonly docker: DockerService,
    private readonly registryService: DockerRegistryService
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

  // Batch Update Endpoints
  @Post('batch-update')
  async batchUpdate(@Body() body: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipValidation?: boolean;
    skipCritical?: boolean;
    maxConcurrent?: number;
    rollbackOnFailure?: boolean;
    updateStrategy?: 'sequential' | 'parallel' | 'rolling';
    delayBetweenUpdates?: number;
  }) {
    return this.containers.batchUpdate(body);
  }

  @Post('batch-update-compose')
  async batchUpdateCompose(@Body() body: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipValidation?: boolean;
    skipCritical?: boolean;
    maxConcurrent?: number;
    rollbackOnFailure?: boolean;
    updateStrategy?: 'sequential' | 'parallel' | 'rolling';
    delayBetweenUpdates?: number;
  }) {
    return this.containers.batchUpdateCompose(body);
  }

  @Post('batch-check-updates')
  async batchCheckUpdates(@Body() body: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipCritical?: boolean;
    batchSize?: number;
    onlyOutdated?: boolean;
  }) {
    return this.containers.batchCheckUpdates(body);
  }

  @Post('validate-batch-update')
  async validateBatchUpdate(@Body() body: {
    containerIds: string[];
    hostId?: string;
  }) {
    return this.containers.validateBatchUpdate(body.containerIds, body.hostId);
  }

  // Container Update Automation Endpoints (using automation system)
  // Note: Main automation endpoints are available at /api/v1/automations
  // These are container-specific convenience endpoints

  @Get('automation/schedules')
  async listContainerUpdateSchedules() {
    // This will be handled by the automation system
    // Return container-specific automation rules
    return {
      message: 'Container update schedules are now managed through the automation system at /api/v1/automations',
      migrationRequired: true
    };
  }



  // Progress Tracking Endpoints
  @Get('progress/:operationId')
  async getUpdateProgress(@Param('operationId') operationId: string) {
    const progress = await this.containers.getUpdateProgress(operationId);
    if (!progress) {
      throw new NotFoundException(`Progress for operation ${operationId} not found`);
    }
    return progress;
  }

  @Get('progress')
  async getAllActiveUpdateProgress() {
    return this.containers.getAllActiveUpdateProgress();
  }

  @Get('progress/:operationId/history')
  async getUpdateProgressHistory(@Param('operationId') operationId: string) {
    return this.containers.getUpdateProgressHistory(operationId);
  }

  @Put('progress/notifications/config')
  async updateProgressNotificationConfig(@Body() config: any) {
    await this.containers.updateProgressNotificationConfig(config);
    return { success: true };
  }

  // Update History Endpoints
  @Get(':id/history')
  async getContainerUpdateHistory(@Param('id') id: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit) : 20;
    return this.containers.getContainerUpdateHistory(id, limitNum);
  }

  @Get('history/host/:hostId')
  async getHostUpdateHistory(@Param('hostId') hostId: string, @Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit) : 50;
    return this.containers.getHostUpdateHistory(hostId, limitNum);
  }

  @Get('history/operation/:operationId')
  async getOperationUpdateHistory(@Param('operationId') operationId: string) {
    return this.containers.getOperationUpdateHistory(operationId);
  }

  // Rollback Management Endpoints
  @Post('rollback/plan')
  async createRollbackPlan(@Body() body: { containerIds: string[]; targetDate?: string }) {
    const targetDate = body.targetDate ? new Date(body.targetDate) : undefined;
    return this.containers.createRollbackPlan(body.containerIds, targetDate);
  }

  @Get('rollback/plans')
  async listRollbackPlans(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit) : 20;
    return this.containers.listRollbackPlans(limitNum);
  }

  @Get('rollback/plans/:planId')
  async getRollbackPlan(@Param('planId') planId: string) {
    const plan = await this.containers.getRollbackPlan(planId);
    if (!plan) {
      throw new NotFoundException(`Rollback plan ${planId} not found`);
    }
    return plan;
  }

  @Post('rollback/plans/:planId/execute')
  async executeRollbackPlan(@Param('planId') planId: string, @Body() body: { executedBy: string }) {
    return this.containers.executeRollbackPlan(planId, body.executedBy);
  }

  // Update Configuration Endpoints
  @Get('config')
  async getUpdateConfiguration() {
    return this.containers.getUpdateConfiguration();
  }

  @Put('config')
  async updateUpdateConfiguration(@Body() config: any) {
    await this.containers.updateUpdateConfiguration(config);
    return { success: true };
  }

  @Post('config/reset')
  async resetUpdateConfigurationToDefaults() {
    await this.containers.resetUpdateConfigurationToDefaults();
    return { success: true };
  }

  @Get('config/:section')
  async getUpdateConfigurationSection(@Param('section') section: string) {
    return this.containers.getUpdateConfigurationSection(section);
  }

  @Put('config/:section')
  async updateUpdateConfigurationSection(@Param('section') section: string, @Body() sectionConfig: any) {
    await this.containers.updateUpdateConfigurationSection(section, sectionConfig);
    return { success: true };
  }

  @Post('config/validate')
  async validateUpdateConfiguration(@Body() config: any) {
    return this.containers.validateUpdateConfiguration(config);
  }

  // Statistics and Monitoring Endpoints
  @Get('statistics/updates')
  async getUpdateStatistics(@Query('hostIds') hostIds?: string) {
    const hostIdArray = hostIds ? hostIds.split(',') : undefined;
    return this.containers.getUpdateStatistics(hostIdArray);
  }

  // Metrics and Performance Endpoints
  @Get('metrics')
  async getUpdateMetrics(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days) : 30;
    return this.containers.getUpdateMetrics(daysNum);
  }

  @Get('metrics/timerange')
  async getUpdateMetricsForTimeRange(@Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }
    return this.containers.getUpdateMetricsForTimeRange(new Date(startDate), new Date(endDate));
  }

  @Get('metrics/host/:hostId')
  async getHostPerformanceMetrics(@Param('hostId') hostId: string, @Query('days') days?: string) {
    const daysNum = days ? parseInt(days) : 30;
    return this.containers.getHostPerformanceMetrics(hostId, daysNum);
  }

  @Get('metrics/failures')
  async getUpdateFailureAnalysis(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days) : 30;
    return this.containers.getUpdateFailureAnalysis(daysNum);
  }

  @Get('metrics/trends')
  async getUpdatePerformanceTrends(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days) : 30;
    return this.containers.getUpdatePerformanceTrends(daysNum);
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
  async refreshStatus(@Body() body: { host: { id?: string } | { id: 'all' }; containerIds?: string[]; containerNames?: string[]; composeProject?: string; }) {
    return this.containers.refreshStatus(body.host, { containerIds: body.containerIds, containerNames: body.containerNames, composeProject: body.composeProject });
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

  // Registry API 监控和管理端点

  @Get('registry/health')
  async getRegistryHealth() {
    return this.registryService.healthCheck();
  }

  @Get('registry/stats')
  async getRegistryStats() {
    return this.registryService.getStats();
  }

  @Post('registry/maintenance')
  @HttpCode(204)
  async performRegistryMaintenance() {
    await this.registryService.performMaintenance();
  }

  @Post('registry/test/:imageRef')
  async testRegistryApi(@Param('imageRef') imageRef: string) {
    try {
      // 解码 URL 编码的镜像引用
      const decodedImageRef = decodeURIComponent(imageRef);
      const result = await this.registryService.getRemoteImageDigest(decodedImageRef);
      return {
        success: !result.error,
        imageRef: decodedImageRef,
        digest: result.digest,
        error: result.error,
        rateLimited: result.rateLimited,
      };
    } catch (error) {
      return {
        success: false,
        imageRef: decodeURIComponent(imageRef),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Post('registry/diagnose')
  async diagnoseRegistryConnectivity() {
    try {
      const diagnostics = await this.registryService.diagnoseNetworkConnectivity();
      return {
        success: true,
        diagnostics,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      };
    }
  }
}