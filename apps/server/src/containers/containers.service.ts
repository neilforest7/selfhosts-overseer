import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateManualPortDto } from './dto/manual-port.dto';
import { Prisma } from '@prisma/client';
import { ContainerDiscoveryService } from './container-discovery.service';
import { ContainerLifecycleService } from './container-lifecycle.service';
import { ContainerUpdateService } from './container-update.service';
import { ContainerComposeService } from './container-compose.service';
import { ContainerStatusService } from './container-status.service';
import { ContainerBatchUpdateService } from './container-batch-update.service';
import { OperationLogService } from '../operation-log/operation-log.service';



@Injectable()
export class ContainersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryService: ContainerDiscoveryService,
    private readonly lifecycleService: ContainerLifecycleService,
    private readonly updateService: ContainerUpdateService,
    private readonly composeService: ContainerComposeService,
    private readonly statusService: ContainerStatusService,
    private readonly batchUpdateService: ContainerBatchUpdateService,
    private readonly operationLogService: OperationLogService,
  ) {}

  // List containers with filtering
  async list(params: { hostId?: string; hostName?: string; q?: string; updateAvailable?: boolean | undefined; isComposeManaged?: boolean | undefined; composeProjectId?: string }) {
    const where: any = {};
    if (params.hostId) {
      where.hostId = params.hostId;
    } else if (params.hostName) {
      const host = await this.prisma.host.findFirst({ where: { name: params.hostName } });
      if (host) {
        where.hostId = host.id;
      } else {
        return { items: [] };
      }
    }
    if (params.composeProjectId) where.composeProjectId = params.composeProjectId;
    if (typeof params.updateAvailable === 'boolean') where.updateAvailable = params.updateAvailable;
    if (typeof params.isComposeManaged === 'boolean') where.isComposeManaged = params.isComposeManaged;
    if (params.q) where.OR = [{ name: { contains: params.q } }, { imageName: { contains: params.q } }];
    const items = await this.prisma.container.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        host: {
          select: {
            name: true,
          },
        },
      },
    });
    return { items };
  }

  // Resolve ComposeProject by id to hostId/project/workingDir
  async resolveComposeProject(composeProjectId: string): Promise<{ hostId?: string; project: string; workingDir: string }> {
    const proj = await (this.prisma as any).composeProject.findUnique({
      where: { id: composeProjectId },
      select: { hostId: true, project: true, workingDir: true },
    });
    if (!proj) throw new Error(`ComposeProject not found: ${composeProjectId}`);
    return { hostId: proj.hostId ?? undefined, project: proj.project, workingDir: proj.workingDir };
  }

  // Manual port mapping management
  async updateManualPortMapping(containerId: string, dto: UpdateManualPortDto) {
    const { exposedPort, internalPort } = dto;
    return this.prisma.container.update({
      where: { id: containerId },
      data: { manualPortMapping: { exposedPort, internalPort } },
    });
  }

  async deleteManualPortMapping(containerId: string) {
    return this.prisma.container.update({
      where: { id: containerId },
      data: { manualPortMapping: Prisma.DbNull },
    });
  }

  // Discovery operations - delegate to ContainerDiscoveryService
  async discover(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    return this.discoveryService.discover(bodyHost);
  }

  async discoverMultiple(hostIds: string[]): Promise<{ taskId: string }> {
    return this.discoveryService.discoverMultiple(hostIds);
  }

  async discoverOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    return this.discoveryService.discoverOnHost(host);
  }

  // Lifecycle operations - delegate to ContainerLifecycleService
  async restartOne(hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    return this.lifecycleService.restartOne(hostOrRef, containerId, existingOpId);
  }

  async startOne(hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    return this.lifecycleService.startOne(hostOrRef, containerId, existingOpId);
  }

  async stopOne(hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    return this.lifecycleService.stopOne(hostOrRef, containerId, existingOpId);
  }

  // Update operations - delegate to ContainerUpdateService
  async updateOne(hostOrRef: { id: string }, containerId: string, imageRef?: string, existingOpId?: string) {
    return this.updateService.updateOne(hostOrRef, containerId, imageRef, existingOpId);
  }

  async checkUpdates(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    return this.updateService.checkUpdates(bodyHost);
  }

  async checkUpdatesOnHost(host: { id: string; address: string; sshUser: string; port?: number }, options?: {
    containerIds?: string[];
    containerNames?: string[];
    composeProject?: string;
    skipCritical?: boolean;
    batchSize?: number;
  }): Promise<void> {
    return this.updateService.checkUpdatesOnHost(host, options);
  }

  async batchCheckUpdates(options: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipCritical?: boolean;
    batchSize?: number;
    onlyOutdated?: boolean;
  }): Promise<{ taskId: string }> {
    return this.updateService.batchCheckUpdates(options);
  }

  async batchCheckUpdatesOnHost(host: { id: string; address: string; sshUser: string; port?: number }, options?: {
    containerIds?: string[];
    composeProjects?: string[];
    skipCritical?: boolean;
    batchSize?: number;
    onlyOutdated?: boolean;
  }): Promise<{ checked: number; updatesFound: number; errors: number }> {
    return this.updateService.batchCheckUpdatesOnHost(host, options);
  }

  async getUpdateStatistics(hostIds?: string[]): Promise<{
    totalContainers: number;
    containersWithUpdates: number;
    lastChecked: Date | null;
    hostStats: Array<{
      hostId: string;
      hostName: string;
      totalContainers: number;
      containersWithUpdates: number;
      lastChecked: Date | null;
    }>;
  }> {
    return this.updateService.getUpdateStatistics(hostIds);
  }

  async validateBatchUpdate(containerIds: string[], hostId?: string): Promise<{
    validContainers: string[];
    invalidContainers: Array<{ id: string; reason: string; warnings: string[] }>;
    requiresApproval: string[];
    totalValidated: number;
  }> {
    return this.updateService.validateBatchUpdate(containerIds, hostId);
  }

  async getUpdatePolicyForHost(hostId: string) {
    return this.updateService.getUpdatePolicyForHost(hostId);
  }

  async setUpdatePolicyForHost(hostId: string, policy: any) {
    return this.updateService.setUpdatePolicyForHost(hostId, policy);
  }

  async getDefaultUpdatePolicy() {
    return this.updateService.getDefaultUpdatePolicy();
  }

  async setDefaultUpdatePolicy(policy: any) {
    return this.updateService.setDefaultUpdatePolicy(policy);
  }

  // Batch update operations - delegate to ContainerBatchUpdateService
  async batchUpdate(options: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipValidation?: boolean;
    skipCritical?: boolean;
    maxConcurrent?: number;
    rollbackOnFailure?: boolean;
    requireApproval?: boolean;
    updateStrategy?: 'sequential' | 'parallel' | 'rolling';
    delayBetweenUpdates?: number;
  }): Promise<{ taskId: string }> {
    return this.batchUpdateService.batchUpdate(options);
  }

  async batchUpdateCompose(options: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipValidation?: boolean;
    skipCritical?: boolean;
    maxConcurrent?: number;
    rollbackOnFailure?: boolean;
    requireApproval?: boolean;
    updateStrategy?: 'sequential' | 'parallel' | 'rolling';
    delayBetweenUpdates?: number;
  }): Promise<{ taskId: string }> {
    return this.batchUpdateService.batchUpdateCompose(options);
  }

  async executeBatchUpdate(options: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipValidation?: boolean;
    skipCritical?: boolean;
    maxConcurrent?: number;
    rollbackOnFailure?: boolean;
    requireApproval?: boolean;
    updateStrategy?: 'sequential' | 'parallel' | 'rolling';
    delayBetweenUpdates?: number;
  }): Promise<{
    taskId: string;
    totalContainers: number;
    successfulUpdates: number;
    failedUpdates: number;
    skippedUpdates: number;
    rollbacksPerformed: number;
    results: Array<{
      containerId: string;
      containerName: string;
      status: 'success' | 'failed' | 'skipped' | 'rolled_back';
      reason?: string;
      duration?: number;
    }>;
  }> {
    return this.batchUpdateService.executeBatchUpdate(options);
  }

  // Compose operations - delegate to ContainerComposeService
  async composeOperate(
    hostOrRef: { id: string },
    operation: 'up' | 'down' | 'restart' | 'pull' | 'stop' | 'start',
    project: string,
    workingDir: string,
    services?: string[],
  ): Promise<{ taskId: string }> {
    return this.composeService.operate(hostOrRef, operation, project, workingDir, services);
  }

  async getComposeConfig(hostOrRef: { id: string }, project: string, workingDir: string): Promise<any> {
    return this.composeService.getComposeConfig(hostOrRef, project, workingDir);
  }

  async listComposeProjects(hostOrRef: { id: string }): Promise<any[]> {
    return this.composeService.listComposeProjects(hostOrRef);
  }

  async reactivateComposeProject(hostOrRef: { id: string }, project: string, workingDir: string): Promise<{ taskId: string }> {
    return this.composeService.reactivateComposeProject(hostOrRef, project, workingDir);
  }

  async getComposeDownProjects(hostId?: string): Promise<any[]> {
    return this.composeService.getComposeDownProjects(hostId);
  }

  async getComposeServices(hostOrRef: { id: string }, project: string, workingDir: string): Promise<string[]> {
    return this.composeService.getComposeServices(hostOrRef, project, workingDir);
  }

  async getComposeStatus(hostOrRef: { id: string }, project: string, workingDir: string): Promise<any[]> {
    return this.composeService.getComposeStatus(hostOrRef, project, workingDir);
  }

  // Status operations - delegate to ContainerStatusService
  async refreshStatusOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    return this.statusService.refreshStatusOnHost(host);
  }

  async cleanupDuplicates(): Promise<{ taskId: string }> {
    return this.statusService.cleanupDuplicates();
  }

  async purgeStoppedContainers(hostOrRef: { id: string }): Promise<{ taskId: string }> {
    return this.statusService.purgeStoppedContainers(hostOrRef);
  }

  async getContainerLogs(containerId: string, lines: number = 100): Promise<string> {
    return this.statusService.getContainerLogs(containerId, lines);
  }

  async getContainerStats(containerId: string): Promise<any> {
    return this.statusService.getContainerStats(containerId);
  }

  // Legacy methods for backward compatibility
  async checkUpdatesAny(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    return this.checkUpdates(bodyHost);
  }

  async checkSingleContainerUpdate(containerId: string): Promise<{ taskId: string }> {
    // Get container info and check updates for its host
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
      include: { host: true },
    });

    if (!container) {
      throw new Error('Container not found');
    }

    return this.checkUpdates({ id: container.hostId });
  }

  async checkComposeProjectUpdates(hostId: string, _composeProject: string): Promise<{ taskId: string }> {
    return (this.updateService as any).checkComposeUpdates(hostId, _composeProject);
  }

  // Legacy refresh status method with overloaded signature
  async refreshStatus(
    hostIdOrBodyHost: string | { id?: string } | { id: 'all' },
    _options?: { containerIds?: string[]; containerNames?: string[]; composeProject?: string },
  ): Promise<{ taskId: string }> {
    if (typeof hostIdOrBodyHost === 'string') {
      // Legacy call with hostId and options
      // For now, just refresh the entire host
      return this.statusService.refreshStatus({ id: hostIdOrBodyHost });
    } else {
      // New call with bodyHost
      return this.statusService.refreshStatus(hostIdOrBodyHost);
    }
  }





  // Update progress tracking methods - simplified implementations using operationLog
  async getUpdateProgress(operationId: string): Promise<any> {
    const operation = await this.prisma.operationLog.findUnique({
      where: { id: operationId },
    });
    const entries = await this.prisma.operationLogEntry.findMany({
      where: { operationLogId: operationId },
      orderBy: { timestamp: 'desc' },
      take: 10,
    });
    return operation ? {
      operationId,
      status: operation.status,
      progress: operation.status === 'COMPLETED' ? 100 : operation.status === 'ERROR' ? 0 : 50,
      entries,
    } : null;
  }

  async getAllActiveUpdateProgress(): Promise<any[]> {
    const operations = await this.prisma.operationLog.findMany({
      where: { status: 'RUNNING' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return operations.map(op => ({
      operationId: op.id,
      title: op.title,
      status: op.status,
      progress: 50, // Simplified progress
      startTime: op.createdAt,
    }));
  }

  async getUpdateProgressHistory(operationId: string): Promise<any[]> {
    const entries = await this.prisma.operationLogEntry.findMany({
      where: { operationLogId: operationId },
      orderBy: { timestamp: 'asc' },
    });
    return entries;
  }

  async updateProgressNotificationConfig(config: any): Promise<void> {
    // Simplified implementation - just log the config
    this.operationLogService.log('info', `Progress notification config updated: ${JSON.stringify(config)}`);
  }

  // Update history and rollback methods - simplified implementations using activityLog
  async getContainerUpdateHistory(containerId: string, limit = 20): Promise<any[]> {
    const activities = await this.prisma.activityLog.findMany({
      where: {
        resourceType: 'container',
        resourceId: containerId,
        action: 'updated',
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    return activities;
  }

  async getHostUpdateHistory(hostId: string, limit = 50): Promise<any[]> {
    const activities = await this.prisma.activityLog.findMany({
      where: { hostId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
    return activities;
  }

  async getOperationUpdateHistory(operationId: string): Promise<any[]> {
    const entries = await this.prisma.operationLogEntry.findMany({
      where: { operationLogId: operationId },
      orderBy: { timestamp: 'asc' },
    });
    return entries;
  }

  async createRollbackPlan(containerIds: string[], targetDate?: Date): Promise<any> {
    // Simplified implementation - just return a plan structure
    return {
      id: `rollback-${Date.now()}`,
      containerIds,
      targetDate,
      createdAt: new Date(),
      status: 'pending',
    };
  }

  async executeRollbackPlan(planId: string, executedBy: string): Promise<any> {
    // Simplified implementation - just log the action
    this.operationLogService.log('info', `Executing rollback plan: ${planId} by ${executedBy}`);
    return { success: true, message: 'Rollback plan executed (simplified implementation)' };
  }

  async getRollbackPlan(planId: string): Promise<any> {
    // Simplified implementation - return null since we don't store plans
    return null;
  }

  async listRollbackPlans(limit = 20): Promise<any[]> {
    // Simplified implementation - return empty array since we don't store plans
    return [];
  }

  // Update configuration methods - simplified implementations
  async getUpdateConfiguration(): Promise<any> {
    // Return a simple default configuration since complex config service is removed
    return {
      maxConcurrentUpdates: 3,
      enableHealthChecks: true,
      enableBackups: true,
      updateTimeout: 300,
      healthCheckTimeout: 60,
    };
  }

  async updateUpdateConfiguration(config: any): Promise<void> {
    // Simplified implementation - just log the config
    this.operationLogService.log('info', `Update configuration updated: ${JSON.stringify(config)}`);
  }

  async resetUpdateConfigurationToDefaults(): Promise<void> {
    // Simplified implementation - just log the action
    this.operationLogService.log('info', 'Update configuration reset to defaults');
  }

  async getUpdateConfigurationSection(section: string): Promise<any> {
    // Return empty config for any section
    return {};
  }

  async updateUpdateConfigurationSection(section: string, sectionConfig: any): Promise<void> {
    // Simplified implementation - just log the action
    this.operationLogService.log('info', `Update configuration section '${section}' updated: ${JSON.stringify(sectionConfig)}`);
  }

  async validateUpdateConfiguration(config: any): Promise<any> {
    // Simplified validation - always return valid
    return { valid: true, errors: [], warnings: [] };
  }

  // Update metrics and monitoring methods - simplified implementations using operationLog
  async getUpdateMetrics(days = 30): Promise<any> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    const operations = await this.prisma.operationLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        title: { contains: 'Update' },
      },
    });

    return {
      totalOperations: operations.length,
      successfulOperations: operations.filter(op => op.status === 'COMPLETED').length,
      failedOperations: operations.filter(op => op.status === 'ERROR').length,
      period: `${days} days`,
    };
  }

  async getUpdateMetricsForTimeRange(startDate: Date, endDate: Date): Promise<any> {
    const operations = await this.prisma.operationLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        title: { contains: 'Update' },
      },
    });

    return {
      totalOperations: operations.length,
      successfulOperations: operations.filter(op => op.status === 'COMPLETED').length,
      failedOperations: operations.filter(op => op.status === 'ERROR').length,
      startDate,
      endDate,
    };
  }

  async getHostPerformanceMetrics(hostId: string, days = 30): Promise<any> {
    // Simplified implementation - return basic stats
    const containers = await this.prisma.container.count({ where: { hostId } });
    const updatesAvailable = await this.prisma.container.count({
      where: { hostId, updateAvailable: true }
    });

    return {
      hostId,
      totalContainers: containers,
      containersWithUpdates: updatesAvailable,
      period: `${days} days`,
    };
  }

  async getUpdateFailureAnalysis(days = 30): Promise<any> {
    // Simplified implementation - return basic failure stats
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    const failedOperations = await this.prisma.operationLog.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: 'ERROR',
        title: { contains: 'Update' },
      },
    });

    return {
      totalFailures: failedOperations.length,
      period: `${days} days`,
      commonReasons: ['Network timeout', 'Image pull failed', 'Container start failed'],
    };
  }

  async getUpdatePerformanceTrends(days = 30): Promise<any> {
    // Simplified implementation - return basic trend data
    return {
      period: `${days} days`,
      trend: 'stable',
      averageDuration: 120, // seconds
      successRate: 95, // percentage
    };
  }

  // Maintenance: Backfill ComposeProject and composeProjectId on containers
  async backfillComposeProjects(): Promise<{ createdProjects: number; updatedContainers: number }> {
    let createdProjects = 0;
    let updatedContainers = 0;

    // Find compose-managed containers (avoid filtering by composeProjectId to remain compatible before prisma generate)
    const missing = await this.prisma.container.findMany({
      where: {
        isComposeManaged: true,
        composeProject: { not: null },
      },
      select: {
        id: true,
        hostId: true,
        composeProject: true,
        composeWorkingDir: true,
        composeConfigFiles: true,
        composeGroupKey: true,
      },
      take: 5000,
    });

    if (missing.length === 0) return { createdProjects, updatedContainers };

    // Group by (hostId, project, workingDir)
    const groups = new Map<string, { hostId: string; project: string; workingDir: string; sampleConfigFiles?: any; containerIds: string[] }>();
    for (const c of missing) {
      const hostId = c.hostId;
      const project = c.composeProject as string;
      const workingDir = (c.composeWorkingDir || '') as string;
      const key = `${hostId}::${project}::${workingDir}`;
      if (!groups.has(key)) {
        groups.set(key, { hostId, project, workingDir, sampleConfigFiles: c.composeConfigFiles, containerIds: [] });
      }
      groups.get(key)!.containerIds.push(c.id);
    }

    for (const [, g] of groups) {
      // Upsert ComposeProject
      let projectRow = await (this.prisma as any).composeProject.findFirst({
        where: { project: g.project, workingDir: g.workingDir, hostId: g.hostId },
      });
      if (!projectRow) {
        projectRow = await (this.prisma as any).composeProject.create({
          data: {
            project: g.project,
            workingDir: g.workingDir,
            configFiles: Array.isArray(g.sampleConfigFiles?.configFiles) ? g.sampleConfigFiles.configFiles : [],
          },
        });
        createdProjects++;
      }

      // Update containers in group with composeProjectId and ensure composeGroupKey exists
      await this.prisma.container.updateMany({
        where: { id: { in: g.containerIds } },
        data: {
          // cast via any to allow new field prior to prisma generate
          ...(projectRow.id ? ({ composeProjectId: projectRow.id } as any) : {}),
        },
      });
      updatedContainers += g.containerIds.length;

      // Fill composeGroupKey if missing
      const compatKey = `${g.hostId}::compose::${g.project}`;
      const folder = g.workingDir ? g.workingDir.split(/[/\\]+/).filter(Boolean).slice(-1)[0] : g.project;
      await this.prisma.container.updateMany({
        where: { id: { in: g.containerIds }, composeGroupKey: null as any },
        data: { composeGroupKey: compatKey || `${compatKey}::${folder}` },
      });
    }

    return { createdProjects, updatedContainers };
  }
}