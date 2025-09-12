import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Injectable()
export class ContainerLifecycleService {
  private readonly logger = new Logger(ContainerLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async restartOne(_hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    const opLog = existingOpId ? 
      await this.prisma.operationLog.findUnique({ where: { id: existingOpId } }) :
      await this.operationLogService.create({ title: `Restart Container ${containerId.substring(0, 12)}` });
    
    if (!opLog) throw new Error('Operation log not found');
    
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        if (container.isComposeManaged) {
          await this.restartComposeService(
            container.hostId,
            container.composeProject!,
            container.composeWorkingDir!,
            container.composeService!,
          );
        } else {
          await this.restartCliContainer(container);
        }

        // Log activity
        await this.activityLog.logContainerActivity(
          'restarted',
          container.id,
          container.name,
          container.hostId,
          container.host.name,
          `Container '${container.name}' restarted`,
          container.isComposeManaged
            ? `Compose service '${container.composeService}' in project '${container.composeProject}' restarted`
            : `CLI container restarted`,
          {
            isComposeManaged: container.isComposeManaged,
            composeProject: container.composeProject,
            composeService: container.composeService,
            imageName: container.imageName,
            imageTag: container.imageTag,
          }
        );
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Restart failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });
    return { taskId: opLog.id };
  }

  async startOne(_hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    const opLog = existingOpId ? 
      await this.prisma.operationLog.findUnique({ where: { id: existingOpId } }) :
      await this.operationLogService.create({ title: `Start Container ${containerId.substring(0, 12)}` });
    
    if (!opLog) throw new Error('Operation log not found');
    
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        if (container.isComposeManaged) {
          await this.startComposeService(
            container.hostId,
            container.composeProject!,
            container.composeWorkingDir!,
            container.composeService!,
          );
        } else {
          await this.startCliContainer(container);
        }

        // Log activity
        await this.activityLog.logContainerActivity(
          'started',
          container.id,
          container.name,
          container.hostId,
          container.host.name,
          `Container '${container.name}' started`,
          container.isComposeManaged
            ? `Compose service '${container.composeService}' in project '${container.composeProject}' started`
            : `CLI container started`,
          {
            isComposeManaged: container.isComposeManaged,
            composeProject: container.composeProject,
            composeService: container.composeService,
            imageName: container.imageName,
            imageTag: container.imageTag,
          }
        );
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Start failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });
    return { taskId: opLog.id };
  }

  async stopOne(_hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    const opLog = existingOpId ? 
      await this.prisma.operationLog.findUnique({ where: { id: existingOpId } }) :
      await this.operationLogService.create({ title: `Stop Container ${containerId.substring(0, 12)}` });
    
    if (!opLog) throw new Error('Operation log not found');
    
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        if (container.isComposeManaged) {
          await this.stopComposeService(
            container.hostId,
            container.composeProject!,
            container.composeWorkingDir!,
            container.composeService!,
          );
        } else {
          await this.stopCliContainer(container);
        }

        // Log activity
        await this.activityLog.logContainerActivity(
          'stopped',
          container.id,
          container.name,
          container.hostId,
          container.host.name,
          `Container '${container.name}' stopped`,
          container.isComposeManaged
            ? `Compose service '${container.composeService}' in project '${container.composeProject}' stopped`
            : `CLI container stopped`,
          {
            isComposeManaged: container.isComposeManaged,
            composeProject: container.composeProject,
            composeService: container.composeService,
            imageName: container.imageName,
            imageTag: container.imageTag,
          }
        );
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Stop failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });
    return { taskId: opLog.id };
  }

  private async restartComposeService(hostId: string, project: string, workingDir: string, service: string) {
    const hostCred = await this.getHostCredById(hostId);
    if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

    this.operationLogService.log('info', `Restarting compose service "${service}" in project "${project}"...`);

    const args = ['compose', '--project-directory', workingDir, '-p', project, 'restart', service];
    const { code, stderr } = await this.docker.execStreaming(hostCred, args, 600);

    if (code !== 0) {
      throw new Error(`Failed to restart compose service: ${stderr}`);
    }

    this.operationLogService.log('info', `Compose service "${service}" restarted successfully. Refreshing status...`);
    await this.refreshComposeProjectStatus(hostId, project);
  }

  private async startComposeService(hostId: string, project: string, workingDir: string, service: string) {
    const hostCred = await this.getHostCredById(hostId);
    if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

    this.operationLogService.log('info', `Starting compose service "${service}" in project "${project}"...`);

    const args = ['compose', '--project-directory', workingDir, '-p', project, 'start', service];
    const { code, stderr } = await this.docker.execStreaming(hostCred, args, 600);

    if (code !== 0) {
      throw new Error(`Failed to start compose service: ${stderr}`);
    }

    this.operationLogService.log('info', `Compose service "${service}" started successfully. Refreshing status...`);
    await this.refreshComposeProjectStatus(hostId, project);
  }

  private async stopComposeService(hostId: string, project: string, workingDir: string, service: string) {
    const hostCred = await this.getHostCredById(hostId);
    if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

    this.operationLogService.log('info', `Stopping compose service "${service}" in project "${project}"...`);

    const args = ['compose', '--project-directory', workingDir, '-p', project, 'stop', service];
    const { code, stderr } = await this.docker.execStreaming(hostCred, args, 600);

    if (code !== 0) {
      throw new Error(`Failed to stop compose service: ${stderr}`);
    }

    this.operationLogService.log('info', `Compose service "${service}" stopped successfully. Refreshing status...`);
    await this.refreshComposeProjectStatus(hostId, project);
  }

  private async restartCliContainer(container: any) {
    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

    this.operationLogService.log('info', `Attempting to restart container "${container.name}"...`);
    const { code, stderr } = await this.docker.exec(hostCred, ['restart', container.containerId], 120);
    if (code !== 0) {
      throw new Error(`Failed to restart container: ${stderr}`);
    }
    this.operationLogService.log('info', `Container "${container.name}" restarted successfully. Refreshing status...`);
    await this.refreshContainerStatus(container.hostId, [container.containerId]);
  }

  private async startCliContainer(container: any) {
    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

    this.operationLogService.log('info', `Attempting to start container "${container.name}"...`);
    const { code, stderr } = await this.docker.exec(hostCred, ['start', container.containerId], 120);
    if (code !== 0) {
      throw new Error(`Failed to start container: ${stderr}`);
    }
    this.operationLogService.log('info', `Container "${container.name}" started successfully. Refreshing status...`);
    await this.refreshContainerStatus(container.hostId, [container.containerId]);
  }

  private async stopCliContainer(container: any) {
    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

    this.operationLogService.log('info', `Attempting to stop container "${container.name}"...`);
    const { code, stderr } = await this.docker.exec(hostCred, ['stop', container.containerId], 120);
    if (code !== 0) {
      throw new Error(`Failed to stop container: ${stderr}`);
    }
    this.operationLogService.log('info', `Container "${container.name}" stopped successfully. Refreshing status...`);
    await this.refreshContainerStatus(container.hostId, [container.containerId]);
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
        // For lifecycle operations, containers might be stopped but not removed
        // Check if they still exist with docker ps -a
        const allContainersResult = await this.docker.exec(hostCred, ['ps', '-a', '--format', 'json'], 60);
        const allContainerIds = new Set();

        if (allContainersResult.code === 0) {
          const lines = allContainersResult.stdout.trim().split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              allContainerIds.add(parsed.ID);
            } catch {
              // ignore invalid JSON lines
            }
          }
        }

        // Separate truly removed containers from stopped ones
        const trulyRemovedContainers = removedContainers.filter(c => !allContainerIds.has(c.containerId));
        const stoppedContainers = removedContainers.filter(c => allContainerIds.has(c.containerId));

        // Delete truly removed containers
        if (trulyRemovedContainers.length > 0) {
          await this.prisma.container.deleteMany({
            where: { id: { in: trulyRemovedContainers.map(c => c.id) } },
          });
        }

        // Mark stopped containers as exited
        if (stoppedContainers.length > 0) {
          await this.prisma.container.updateMany({
            where: { id: { in: stoppedContainers.map(c => c.id) } },
            data: { state: 'exited', status: 'exited' },
          });
        }
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
