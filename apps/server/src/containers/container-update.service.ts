import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { TasksService } from '../tasks/tasks.service';
import { ContextService } from '../context/context.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Injectable()
export class ContainerUpdateService {
  private readonly logger = new Logger(ContainerUpdateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
    private readonly activityLog: ActivityLogService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
  ) {}

  async updateOne(_hostOrRef: { id: string }, containerId: string, imageRef?: string, existingOpId?: string) {
    const opLog = existingOpId ? 
      await this.prisma.operationLog.findUnique({ where: { id: existingOpId } }) :
      await this.operationLogService.create({
        title: `Update Container ${containerId.substring(0, 12)}`,
      });
    
    if (!opLog) throw new Error('Operation log not found');
    
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        const oldImageTag = container.imageTag;
        const oldRepoDigest = container.repoDigest;

        if (container.isComposeManaged) {
          await this._updateComposeContainer(container, imageRef);
        } else {
          await this._updateCliContainer(container, imageRef);
        }

        // Get updated container info for activity logging
        const updatedContainer = await this.prisma.container.findUnique({
          where: { id: containerId },
        });

        // Log activity
        await this.activityLog.logContainerActivity(
          'updated',
          container.id,
          container.name,
          container.hostId,
          container.host.name,
          `Container '${container.name}' updated`,
          container.isComposeManaged
            ? `Compose service '${container.composeService}' in project '${container.composeProject}' updated`
            : `CLI container updated`,
          {
            isComposeManaged: container.isComposeManaged,
            composeProject: container.composeProject,
            composeService: container.composeService,
            imageName: container.imageName,
            customImageRef: imageRef,
          },
          {
            imageTag: oldImageTag,
            repoDigest: oldRepoDigest,
          },
          {
            imageTag: updatedContainer?.imageTag,
            repoDigest: updatedContainer?.repoDigest,
          }
        );
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Update failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });
    return { taskId: opLog.id };
  }

  async checkUpdates(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    const existingOpId = this.contextService.getOpId();

    if (existingOpId) {
      this.operationLogService.log('info', `Using existing OperationLog context: ${existingOpId}`);

      let targetHostIds: string[];
      const hostId = bodyHost ? ((bodyHost as any).id as string | undefined) : undefined;
      if (!hostId || hostId === 'all') {
        const hosts = await this.prisma.host.findMany({ select: { id: true }, take: 1000 });
        targetHostIds = hosts.map(h => h.id);
      } else {
        targetHostIds = [hostId];
      }

      await this.tasksService.exec({
        command: 'internal:check_container_updates',
        targets: targetHostIds,
      });

      return { taskId: existingOpId };
    } else {
      const opLog = await this.operationLogService.create({ title: `Check Container Updates` });

      return this.contextService.run(opLog.id, async () => {
        let targetHostIds: string[];
        const hostId = bodyHost ? ((bodyHost as any).id as string | undefined) : undefined;
        if (!hostId || hostId === 'all') {
          const hosts = await this.prisma.host.findMany({ select: { id: true }, take: 1000 });
          targetHostIds = hosts.map(h => h.id);
        } else {
          targetHostIds = [hostId];
        }

        await this.tasksService.exec({
          command: 'internal:check_container_updates',
          targets: targetHostIds,
        });

        return { taskId: opLog.id };
      });
    }
  }

  async checkUpdatesOnHost(host: { id: string; address: string; sshUser: string; port?: number }, options?: {
    containerIds?: string[];
    containerNames?: string[];
    composeProject?: string;
    skipCritical?: boolean;
    batchSize?: number;
  }): Promise<void> {
    this.operationLogService.log('info', `Starting update check on host ${host.address}`);
    this.operationLogService.log('info', `[${host.address}] Starting container update check...`, host.id);

    try {
      const containers = await this.prisma.container.findMany({
        where: { hostId: host.id },
        select: {
          id: true,
          containerId: true,
          name: true,
          imageName: true,
          imageTag: true,
          repoDigest: true,
        },
      });

      this.operationLogService.log('info', `[${host.address}] Checking updates for ${containers.length} containers`, host.id);

      const hostCred = await this.getHostCredById(host.id);
      if (!hostCred) throw new Error(`Host credentials not found for ${host.id}`);

      for (const container of containers) {
        try {
          await this.checkSingleContainerUpdate(hostCred, container);
        } catch (error) {
          this.logger.warn(`Failed to check update for container ${container.name}: ${error}`);
          this.operationLogService.log('error', `[${host.address}] Failed to check update for ${container.name}: ${error}`, host.id);
        }
      }

      this.operationLogService.log('info', `[${host.address}] Container update check completed`, host.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `[${host.address}] Update check failed: ${errorMessage}`, host.id);
      throw error;
    }
  }

  private async checkSingleContainerUpdate(hostCred: any, container: any): Promise<void> {
    if (!container.imageName || !container.imageTag) {
      return; // Skip containers without proper image info
    }

    const imageRef = `${container.imageName}:${container.imageTag}`;
    
    // Check for updates
    const updateResult = await this.docker.checkImageUpdate(
      hostCred,
      imageRef,
      container.repoDigest
    );

    // Update the container record (handle case where container might have been deleted)
    try {
      await this.prisma.container.update({
        where: { id: container.id },
        data: {
          updateAvailable: updateResult.updateAvailable,
          remoteDigest: updateResult.remoteDigest,
          updateCheckedAt: new Date(),
        },
      });
    } catch (error: any) {
      // If container record not found, it might have been deleted during discovery
      if (error.code === 'P2025') {
        this.operationLogService.log('info', `Container ${container.name} no longer exists in database, skipping update`);
        return;
      }
      // Re-throw other errors
      throw error;
    }

    if (updateResult.updateAvailable) {
      this.operationLogService.log('info', `Update available for ${container.name} (${imageRef})`);
    }
  }

  private async _updateComposeContainer(container: any, imageRef?: string): Promise<void> {
    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

    this.operationLogService.log('info', `Updating compose service "${container.composeService}" in project "${container.composeProject}"...`);

    // Pull the latest image
    if (imageRef) {
      this.operationLogService.log('info', `Pulling image: ${imageRef}`);
      const pullResult = await this.docker.pullImage(hostCred, imageRef);
      if (pullResult !== 0) {
        throw new Error(`Failed to pull image ${imageRef}`);
      }
    } else {
      // Pull the service image
      const pullArgs = ['compose', '--project-directory', container.composeWorkingDir, '-p', container.composeProject, 'pull', container.composeService];
      const { code: pullCode, stderr: pullStderr } = await this.docker.execStreaming(hostCred, pullArgs, 600);
      if (pullCode !== 0) {
        throw new Error(`Failed to pull compose service image: ${pullStderr}`);
      }
    }

    // Recreate the service
    this.operationLogService.log('info', `Recreating compose service...`);
    const upArgs = ['compose', '--project-directory', container.composeWorkingDir, '-p', container.composeProject, 'up', '-d', '--no-deps', container.composeService];
    const { code: upCode, stderr: upStderr } = await this.docker.execStreaming(hostCred, upArgs, 600);

    if (upCode !== 0) {
      throw new Error(`Failed to recreate compose service: ${upStderr}`);
    }

    this.operationLogService.log('info', `Compose service "${container.composeService}" updated successfully. Refreshing status...`);
    await this.refreshComposeProjectStatus(container.hostId, container.composeProject);
  }

  private async _updateCliContainer(container: any, imageRef?: string): Promise<void> {
    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

    const targetImageRef = imageRef || `${container.imageName}:${container.imageTag}`;
    
    this.operationLogService.log('info', `Updating CLI container "${container.name}" with image: ${targetImageRef}`);

    // Pull the new image
    this.operationLogService.log('info', `Pulling image: ${targetImageRef}`);
    const pullResult = await this.docker.pullImage(hostCred, targetImageRef);
    if (pullResult !== 0) {
      throw new Error(`Failed to pull image ${targetImageRef}`);
    }

    // Stop the current container
    this.operationLogService.log('info', `Stopping current container...`);
    const { code: stopCode } = await this.docker.exec(hostCred, ['stop', container.containerId], 120);
    if (stopCode !== 0) {
      this.operationLogService.log('info', `Failed to stop container gracefully, continuing...`);
    }

    // Create backup by renaming
    const backupName = `${container.name}_backup_${Date.now()}`;
    this.operationLogService.log('info', `Creating backup: ${backupName}`);
    const { code: renameCode } = await this.docker.exec(hostCred, ['rename', container.containerId, backupName], 60);
    if (renameCode !== 0) {
      throw new Error(`Failed to create backup of container`);
    }

    try {
      // Create new container with updated image
      if (!container.runCommand) {
        throw new Error(`No run command available for container ${container.name}`);
      }

      // Replace the image in the run command
      const updatedRunCommand = this.updateImageInRunCommand(container.runCommand, targetImageRef);
      
      this.operationLogService.log('info', `Creating new container with updated image...`);
      const { code: createCode, stderr: createStderr } = await this.docker.execShell(hostCred, updatedRunCommand, { timeout: 300 });
      
      if (createCode !== 0) {
        throw new Error(`Failed to create new container: ${createStderr}`);
      }

      // Start the new container
      this.operationLogService.log('info', `Starting new container...`);
      const { code: startCode, stderr: startStderr } = await this.docker.exec(hostCred, ['start', container.name], 120);
      
      if (startCode !== 0) {
        throw new Error(`Failed to start new container: ${startStderr}`);
      }

      // Wait a bit and check if container is running
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const { code: psCode, stdout: psStdout } = await this.docker.exec(hostCred, ['ps', '--filter', `name=${container.name}`, '--format', 'json'], 30);
      
      if (psCode === 0 && psStdout.trim()) {
        // New container is running, remove backup
        this.operationLogService.log('info', `New container is running successfully. Removing backup...`);
        await this.docker.exec(hostCred, ['rm', backupName], 60);
        this.operationLogService.log('info', `Container "${container.name}" updated successfully. Refreshing status...`);
      } else {
        throw new Error(`New container failed to start properly`);
      }

    } catch (error) {
      // Rollback: restore backup
      this.operationLogService.log('error', `Update failed, rolling back...`);
      
      // Remove failed new container if it exists
      await this.docker.exec(hostCred, ['rm', '-f', container.name], 60);
      
      // Restore backup
      const { code: restoreCode } = await this.docker.exec(hostCred, ['rename', backupName, container.name], 60);
      if (restoreCode === 0) {
        await this.docker.exec(hostCred, ['start', container.name], 120);
        this.operationLogService.log('info', `Rollback completed. Original container restored.`);
      }
      
      throw error;
    }

    await this.refreshContainerStatus(container.hostId, [container.containerId]);
  }

  private updateImageInRunCommand(runCommand: string, newImageRef: string): string {
    // Simple regex to replace the image reference in the run command
    // This assumes the image is the last argument before any command
    const imageRegex = /(\s+)([^\s]+)(\s*$|\s+[^-])/;
    return runCommand.replace(imageRegex, `$1${newImageRef}$3`);
  }

  private async refreshComposeProjectStatus(hostId: string, project: string) {
    try {
      const hostCred = await this.getHostCredById(hostId);
      if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

      // Get current containers for this project from Docker
      const currentContainers = await this.docker.psByComposeProject(hostCred, project, 60);
      const currentContainerIds = new Set(currentContainers.map(c => c.ID).filter(Boolean));

      // Get containers for this project from database
      const dbContainers = await this.prisma.container.findMany({
        where: {
          hostId,
          composeProject: project,
          isComposeManaged: true,
        },
        select: { id: true, containerId: true, name: true },
      });

      // Update existing containers
      if (currentContainers.length > 0) {
        const containerIds = currentContainers.map(c => c.ID).filter(Boolean);
        if (containerIds.length > 0) {
          const inspectData = await this.docker.inspectContainers(hostCred, containerIds, 120);
          await this.updateContainerData(hostId, inspectData);
        }
      }

      // Handle removed containers
      const removedContainers = dbContainers.filter(dbContainer =>
        !currentContainerIds.has(dbContainer.containerId)
      );

      if (removedContainers.length > 0) {
        // For update operations, containers are typically recreated, so delete old ones
        await this.prisma.container.deleteMany({
          where: { id: { in: removedContainers.map(c => c.id) } },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to refresh compose project status for ${project}: ${error}`);
    }
  }

  private async refreshContainerStatus(hostId: string, containerIds: string[]) {
    try {
      const hostCred = await this.getHostCredById(hostId);
      if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

      const inspectData = await this.docker.inspectContainers(hostCred, containerIds, 120);
      await this.updateContainerData(hostId, inspectData);
    } catch (error) {
      this.logger.error(`Failed to refresh container status: ${error}`);
    }
  }

  private async updateContainerData(_hostId: string, inspectData: any[]): Promise<void> {
    for (const containerData of inspectData) {
      try {
        const containerId = containerData.Id;
        const state = containerData.State?.Status || 'unknown';
        const status = containerData.State?.Status || 'unknown';
        const restartCount = containerData.RestartCount || 0;
        const startedAt = containerData.State?.StartedAt ? new Date(containerData.State.StartedAt) : null;

        await this.prisma.container.updateMany({
          where: { containerId },
          data: {
            state,
            status,
            restartCount,
            startedAt,
          },
        });
      } catch (error) {
        this.logger.error(`Failed to update container ${containerData.Id}: ${error}`);
      }
    }
  }

  // Batch operations - simplified implementations for API compatibility
  async batchCheckUpdates(options: {
    hostIds?: string[];
    containerIds?: string[];
    composeProjects?: string[];
    skipCritical?: boolean;
    batchSize?: number;
    onlyOutdated?: boolean;
  }): Promise<{ taskId: string }> {
    // Note: skipCritical option is maintained for API compatibility but no longer filters containers
    const hostId = options.hostIds?.[0] || 'all';
    return this.checkUpdates({ id: hostId });
  }

  async batchCheckUpdatesOnHost(host: { id: string; address: string; sshUser: string; port?: number }, options?: {
    containerIds?: string[];
    composeProjects?: string[];
    skipCritical?: boolean;
    batchSize?: number;
    onlyOutdated?: boolean;
  }): Promise<{ checked: number; updatesFound: number; errors: number }> {
    // Note: skipCritical option is maintained for API compatibility but no longer filters containers
    await this.checkUpdatesOnHost(host, options);

    // Return basic statistics
    const containers = await this.prisma.container.findMany({
      where: { hostId: host.id },
      select: { updateAvailable: true },
    });

    return {
      checked: containers.length,
      updatesFound: containers.filter(c => c.updateAvailable).length,
      errors: 0,
    };
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
    const whereCondition = hostIds ? { hostId: { in: hostIds } } : {};

    const containers = await this.prisma.container.findMany({
      where: whereCondition,
      select: {
        hostId: true,
        updateAvailable: true,
        updateCheckedAt: true,
        host: { select: { name: true } },
      },
    });

    const totalContainers = containers.length;
    const containersWithUpdates = containers.filter(c => c.updateAvailable).length;
    const lastChecked = containers.reduce((latest, c) => {
      if (!c.updateCheckedAt) return latest;
      return !latest || c.updateCheckedAt > latest ? c.updateCheckedAt : latest;
    }, null as Date | null);

    // Group by host for host stats
    const hostStatsMap = new Map();
    containers.forEach(c => {
      if (!hostStatsMap.has(c.hostId)) {
        hostStatsMap.set(c.hostId, {
          hostId: c.hostId,
          hostName: c.host.name,
          totalContainers: 0,
          containersWithUpdates: 0,
          lastChecked: null as Date | null,
        });
      }
      const stats = hostStatsMap.get(c.hostId);
      stats.totalContainers++;
      if (c.updateAvailable) stats.containersWithUpdates++;
      if (c.updateCheckedAt && (!stats.lastChecked || c.updateCheckedAt > stats.lastChecked)) {
        stats.lastChecked = c.updateCheckedAt;
      }
    });

    return {
      totalContainers,
      containersWithUpdates,
      lastChecked,
      hostStats: Array.from(hostStatsMap.values()),
    };
  }

  async validateBatchUpdate(containerIds: string[], hostId?: string): Promise<{
    validContainers: string[];
    invalidContainers: Array<{ id: string; reason: string; warnings: string[] }>;
    requiresApproval: string[];
    totalValidated: number;
  }> {
    // Simplified validation - all containers are considered valid since we removed safety checks
    const containers = await this.prisma.container.findMany({
      where: {
        id: { in: containerIds },
        ...(hostId && { hostId }),
      },
      select: { id: true },
    });

    const validIds = containers.map(c => c.id);
    const invalidIds = containerIds.filter(id => !validIds.includes(id));

    return {
      validContainers: validIds,
      invalidContainers: invalidIds.map(id => ({
        id,
        reason: 'Container not found',
        warnings: [],
      })),
      requiresApproval: [], // No approval required since safety checks are removed
      totalValidated: containerIds.length,
    };
  }

  async getUpdatePolicyForHost(hostId: string) {
    // Return a simple policy since complex policies are removed
    return {
      hostId,
      skipCriticalContainers: false, // Always false since we removed this feature
      requireApprovalForImages: [],
      maxConcurrentUpdates: 3,
      enableHealthChecks: true,
      enableBackups: true,
    };
  }

  async setUpdatePolicyForHost(hostId: string, policy: any) {
    // Simplified policy setting - just log the action since complex policies are removed
    this.logger.log(`Update policy set for host ${hostId}: ${JSON.stringify(policy)}`);
    return { success: true, message: 'Policy updated (simplified implementation)' };
  }

  async getDefaultUpdatePolicy() {
    // Return a simple default policy since complex policies are removed
    return {
      skipCriticalContainers: false, // Always false since we removed this feature
      requireApprovalForImages: [],
      maxConcurrentUpdates: 3,
      enableHealthChecks: true,
      enableBackups: true,
      allowedUpdateWindows: [], // No time restrictions
    };
  }

  async setDefaultUpdatePolicy(policy: any) {
    // Simplified policy setting - just log the action since complex policies are removed
    this.logger.log(`Default update policy set: ${JSON.stringify(policy)}`);
    return { success: true, message: 'Default policy updated (simplified implementation)' };
  }

  private async getHostCredById(hostId: string) {
    const host = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!host) return null;

    return {
      id: host.id,
      address: host.address,
      sshUser: host.sshUser,
      port: host.port ?? undefined,
      password: host.sshPassword ? this.crypto.decryptString(host.sshPassword)?.toString() : undefined,
      privateKey: host.sshPrivateKey ? this.crypto.decryptString(host.sshPrivateKey)?.toString() : undefined,
      privateKeyPassphrase: host.sshPrivateKeyPassphrase ? this.crypto.decryptString(host.sshPrivateKeyPassphrase)?.toString() : undefined,
    };
  }
}
