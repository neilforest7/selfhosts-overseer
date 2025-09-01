import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { TasksService } from '../tasks/tasks.service';
import { ContextService } from '../context/context.service';

@Injectable()
export class ContainerStatusService {
  private readonly logger = new Logger(ContainerStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
  ) {}

  async refreshStatus(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    const existingOpId = this.contextService.getOpId();

    if (existingOpId) {
      console.log(`Using existing OperationLog context: ${existingOpId}`);

      let targetHostIds: string[];
      const hostId = bodyHost ? ((bodyHost as any).id as string | undefined) : undefined;
      if (!hostId || hostId === 'all') {
        const hosts = await this.prisma.host.findMany({ select: { id: true }, take: 1000 });
        targetHostIds = hosts.map(h => h.id);
      } else {
        targetHostIds = [hostId];
      }

      await this.tasksService.exec({
        command: 'internal:refresh_container_status',
        targets: targetHostIds,
      });

      return { taskId: existingOpId };
    } else {
      const opLog = await this.operationLogService.create({ title: `Refresh Container Status` });

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
          command: 'internal:refresh_container_status',
          targets: targetHostIds,
        });

        return { taskId: opLog.id };
      });
    }
  }

  async refreshStatusOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    console.log(`[ContainerStatusService] Starting status refresh on host ${host.address}`);
    this.operationLogService.log('info', `[${host.address}] Starting container status refresh...`, host.id);

    try {
      const hostCred = await this.getHostCredById(host.id);
      if (!hostCred) throw new Error(`Host credentials not found for ${host.id}`);

      // Get all containers for this host
      const containers = await this.prisma.container.findMany({
        where: { hostId: host.id },
        select: { containerId: true, name: true },
      });

      if (containers.length === 0) {
        this.operationLogService.log('info', `[${host.address}] No containers found to refresh`, host.id);
        return;
      }

      this.operationLogService.log('info', `[${host.address}] Refreshing status for ${containers.length} containers`, host.id);

      const containerIds = containers.map(c => c.containerId);
      const inspectData = await this.docker.inspectContainers(hostCred, containerIds, 120);
      
      await this.updateContainerStatuses(inspectData);

      this.operationLogService.log('info', `[${host.address}] Container status refresh completed`, host.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `[${host.address}] Status refresh failed: ${errorMessage}`, host.id);
      throw error;
    }
  }

  async refreshSingleContainer(containerId: string): Promise<void> {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
      include: { host: true },
    });

    if (!container) {
      throw new Error(`Container with id ${containerId} not found`);
    }

    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) {
      throw new Error(`Host credentials not found for ${container.hostId}`);
    }

    const inspectData = await this.docker.inspectContainers(hostCred, [container.containerId], 60);
    if (inspectData.length > 0) {
      await this.updateContainerStatuses(inspectData);
    }
  }

  async refreshComposeProject(hostId: string, project: string): Promise<void> {
    const hostCred = await this.getHostCredById(hostId);
    if (!hostCred) throw new Error(`Host credentials not found for ${hostId}`);

    try {
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
          await this.updateContainerStatuses(inspectData);
        }
      }

      // Handle removed containers
      const removedContainers = dbContainers.filter(dbContainer =>
        !currentContainerIds.has(dbContainer.containerId)
      );

      if (removedContainers.length > 0) {
        // Check if containers still exist but are stopped
        const allContainersResult = await this.docker.exec(hostCred, ['ps', '-a', '--format', 'json'], 60);
        const allContainerIds = new Set();

        if (allContainersResult.code === 0) {
          const lines = allContainersResult.stdout.trim().split('\n').filter(line => line.trim());
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              allContainerIds.add(parsed.ID);
            } catch {}
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
      this.logger.error(`Failed to refresh compose project ${project}: ${error}`);
      throw error;
    }
  }

  async cleanupDuplicates(): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: 'Cleanup Duplicate Containers' });

    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        this.operationLogService.log('info', 'Starting cleanup of duplicate containers...');

        // Find duplicates by containerId
        const duplicates = await this.prisma.container.groupBy({
          by: ['containerId'],
          having: {
            containerId: {
              _count: {
                gt: 1,
              },
            },
          },
          _count: {
            containerId: true,
          },
        });

        this.operationLogService.log('info', `Found ${duplicates.length} duplicate container groups`);

        for (const duplicate of duplicates) {
          const containers = await this.prisma.container.findMany({
            where: { containerId: duplicate.containerId },
            orderBy: { createdAt: 'desc' },
          });

          // Keep the most recent one, delete the rest
          const toDelete = containers.slice(1);
          
          if (toDelete.length > 0) {
            await this.prisma.container.deleteMany({
              where: {
                id: {
                  in: toDelete.map(c => c.id),
                },
              },
            });

            this.operationLogService.log('info', `Removed ${toDelete.length} duplicate entries for container ${duplicate.containerId}`);
          }
        }

        this.operationLogService.log('info', 'Duplicate cleanup completed successfully');
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Cleanup failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });

    return { taskId: opLog.id };
  }

  async purgeStoppedContainers(hostOrRef: { id: string }): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: 'Purge Stopped Containers' });

    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const hostCred = await this.getHostCredById(hostOrRef.id);
        if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

        this.operationLogService.log('info', 'Purging stopped containers...');

        // Remove stopped containers
        const { code, stderr } = await this.docker.exec(hostCred, ['container', 'prune', '-f'], 120);
        
        if (code !== 0) {
          throw new Error(`Failed to purge containers: ${stderr}`);
        }

        this.operationLogService.log('info', 'Stopped containers purged successfully');

        // Refresh container status to update our database
        await this.refreshStatusOnHost(hostCred);
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Purge failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });

    return { taskId: opLog.id };
  }

  async getContainerLogs(containerId: string, lines: number = 100): Promise<string> {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
      include: { host: true },
    });

    if (!container) {
      throw new Error(`Container with id ${containerId} not found`);
    }

    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) {
      throw new Error(`Host credentials not found for ${container.hostId}`);
    }

    const { code, stdout, stderr } = await this.docker.exec(
      hostCred,
      ['logs', '--tail', lines.toString(), container.containerId],
      60
    );

    if (code !== 0) {
      throw new Error(`Failed to get container logs: ${stderr}`);
    }

    return stdout;
  }

  async getContainerStats(containerId: string): Promise<any> {
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
      include: { host: true },
    });

    if (!container) {
      throw new Error(`Container with id ${containerId} not found`);
    }

    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) {
      throw new Error(`Host credentials not found for ${container.hostId}`);
    }

    const { code, stdout, stderr } = await this.docker.exec(
      hostCred,
      ['stats', '--no-stream', '--format', 'json', container.containerId],
      30
    );

    if (code !== 0) {
      throw new Error(`Failed to get container stats: ${stderr}`);
    }

    try {
      return JSON.parse(stdout);
    } catch (error) {
      throw new Error(`Failed to parse container stats: ${error}`);
    }
  }

  private async updateContainerStatuses(inspectData: any[]): Promise<void> {
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
