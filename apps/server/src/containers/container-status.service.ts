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
    this.operationLogService.log('info', `Starting status refresh on host ${host.address}`);
    this.operationLogService.log('info', `[${host.address}] Starting container status refresh...`, host.id);

    try {
      const hostCred = await this.getHostCredById(host.id);
      if (!hostCred) throw new Error(`Host credentials not found for ${host.id}`);

      // Get ALL containers from Docker (not just database containers)
      const { code, stdout, stderr } = await this.docker.exec(
        hostCred,
        ['ps', '-a', '--format', 'json'],
        60
      );

      if (code !== 0) {
        throw new Error(`Failed to get container status: ${stderr}`);
      }

      // Parse Docker container data
      const dockerContainers = this.parseDockerContainerOutput(stdout);
      this.operationLogService.log('info', `[${host.address}] Found ${dockerContainers.length} containers in Docker`, host.id);

      // Get database containers for comparison
      const dbContainers = await this.prisma.container.findMany({
        where: { hostId: host.id },
        select: {
          id: true,
          containerId: true,
          name: true,
          state: true,
          status: true,
          isComposeManaged: true,
          composeProject: true,
          composeService: true
        },
      });

      this.operationLogService.log('info', `[${host.address}] Found ${dbContainers.length} containers in database`, host.id);

      // Perform comprehensive container state comparison
      await this.performContainerStateComparison(host.id, dockerContainers, dbContainers);

      // Perform container cleanup (orphaned CLI containers)
      await this.cleanupOrphanedCliContainers(host.id);

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

    // Use optimized docker ps command for single container status
    const { code, stdout, stderr } = await this.docker.exec(
      hostCred,
      ['ps', '-a', '--filter', `id=${container.containerId}`, '--format', '{{.ID}},{{.Names}},{{.State}},{{.Status}}'],
      30
    );

    if (code !== 0) {
      throw new Error(`Failed to get container status: ${stderr}`);
    }

    await this.updateContainerStatusesFromPs(stdout, container.hostId);
  }

  async refreshContainerStatusOptimized(hostId: string, containerIds: string[]): Promise<void> {
    if (containerIds.length === 0) return;

    const hostCred = await this.getHostCredById(hostId);
    if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

    // Use optimized docker ps command for lightweight status updates
    const { code, stdout, stderr } = await this.docker.exec(
      hostCred,
      ['ps', '-a', ...containerIds.map(id => `--filter=id=${id}`), '--format', '{{.ID}},{{.Names}},{{.State}},{{.Status}}'],
      60
    );

    if (code !== 0) {
      throw new Error(`Failed to get container status: ${stderr}`);
    }

    await this.updateContainerStatusesFromPs(stdout, hostId);
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

  private parseDockerContainerOutput(jsonOutput: string): any[] {
    const lines = jsonOutput.trim().split('\n').filter(line => line.trim());
    const containers: any[] = [];

    for (const line of lines) {
      try {
        const containerData = JSON.parse(line);
        containers.push({
          ID: containerData.ID,
          Names: containerData.Names,
          State: containerData.State,
          Status: containerData.Status,
          Image: containerData.Image,
          Labels: containerData.Labels || {},
          CreatedAt: containerData.CreatedAt,
          Ports: containerData.Ports,
          Mounts: containerData.Mounts,
          Networks: containerData.Networks,
        });
      } catch (error) {
        this.logger.error(`Failed to parse Docker container JSON line "${line}": ${error}`);
      }
    }

    return containers;
  }

  private async performContainerStateComparison(hostId: string, dockerContainers: any[], dbContainers: any[]): Promise<void> {
    // Create maps for efficient lookup
    const dockerContainerMap = new Map();
    const dbContainerMap = new Map();

    // Map Docker containers by ID (both full and short ID)
    dockerContainers.forEach(container => {
      dockerContainerMap.set(container.ID, container);
      dockerContainerMap.set(container.ID.substring(0, 12), container); // Short ID mapping
    });

    // Map database containers by container ID
    dbContainers.forEach(container => {
      dbContainerMap.set(container.containerId, container);
    });

    // 1. Update existing containers with current Docker state
    const updatedContainers: string[] = [];
    for (const dbContainer of dbContainers) {
      const dockerContainer = dockerContainerMap.get(dbContainer.containerId) ||
                             dockerContainerMap.get(dbContainer.containerId.substring(0, 12));

      if (dockerContainer) {
        // Container exists in Docker - update its state
        await this.updateContainerFromDockerData(hostId, dbContainer, dockerContainer);
        updatedContainers.push(dockerContainer.ID);
      } else {
        // Container missing from Docker - mark as removed/exited
        await this.markContainerAsMissing(dbContainer);
      }
    }

    // 2. Detect new containers not in database
    const newContainers = dockerContainers.filter(dockerContainer =>
      !dbContainerMap.has(dockerContainer.ID) &&
      !dbContainerMap.has(dockerContainer.ID.substring(0, 12))
    );

    if (newContainers.length > 0) {
      this.operationLogService.log('info', `Found ${newContainers.length} new containers not in database`);
      // Note: New container discovery should be handled by the discovery service
      // We just log this for now to avoid creating incomplete records
    }

    // 3. Check for compose project health issues
    await this.checkComposeProjectHealth(hostId, dockerContainers, dbContainers);
  }

  private async updateContainerFromDockerData(_hostId: string, dbContainer: any, dockerContainer: any): Promise<void> {
    try {
      await this.prisma.container.update({
        where: { id: dbContainer.id },
        data: {
          state: dockerContainer.State,
          status: dockerContainer.Status,
          // Only update basic status fields during refresh
        },
      });
    } catch (error: any) {
      // If container record not found, it might have been deleted during discovery
      if (error.code === 'P2025') {
        this.operationLogService.log('info', `Container ${dbContainer.name} no longer exists in database, skipping status update`);
        return;
      }
      this.logger.error(`Failed to update container ${dbContainer.name} from Docker data: ${error}`);
    }
  }

  private async markContainerAsMissing(dbContainer: any): Promise<void> {
    try {
      await this.prisma.container.update({
        where: { id: dbContainer.id },
        data: {
          state: 'removed',
          status: 'Container not found in Docker',
        },
      });
      this.operationLogService.log('error', `Container "${dbContainer.name}" not found in Docker - marked as removed`);
    } catch (error: any) {
      // If container record not found, it was already deleted
      if (error.code === 'P2025') {
        this.operationLogService.log('info', `Container ${dbContainer.name} already removed from database`);
        return;
      }
      this.logger.error(`Failed to mark container ${dbContainer.name} as missing: ${error}`);
    }
  }

  private async checkComposeProjectHealth(_hostId: string, dockerContainers: any[], dbContainers: any[]): Promise<void> {
    // Group database containers by compose project
    const composeProjects = new Map<string, any[]>();
    dbContainers
      .filter(container => container.isComposeManaged && container.composeProject)
      .forEach(container => {
        const project = container.composeProject;
        if (!composeProjects.has(project)) {
          composeProjects.set(project, []);
        }
        composeProjects.get(project)!.push(container);
      });

    // Check health of each compose project
    for (const [project, projectContainers] of composeProjects) {
      const runningContainers = projectContainers.filter(container =>
        dockerContainers.some(dc =>
          (dc.ID === container.containerId || dc.ID.startsWith(container.containerId.substring(0, 12))) &&
          dc.State === 'running'
        )
      );

      const totalContainers = projectContainers.length;
      const healthPercentage = totalContainers > 0 ? (runningContainers.length / totalContainers) * 100 : 0;

      if (healthPercentage < 100) {
        this.operationLogService.log('info',
          `Compose project "${project}" health: ${runningContainers.length}/${totalContainers} services running (${healthPercentage.toFixed(1)}%)`
        );
      }
    }
  }

  private async updateContainerStatusesFromPs(psOutput: string, hostId: string): Promise<void> {
    const lines = psOutput.trim().split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        // Parse CSV format: ID,Names,State,Status
        const parts = line.split(',');
        if (parts.length < 4) continue;

        const [containerId, , state, status] = parts;

        // Docker ps returns short container ID, but database stores full ID
        // Use startsWith to match the short ID against the full ID
        await this.prisma.container.updateMany({
          where: {
            hostId,
            containerId: {
              startsWith: containerId.trim()
            }
          },
          data: {
            state: state.trim(),
            status: status.trim(),
          },
        });
      } catch (error) {
        this.logger.error(`Failed to parse container status line "${line}": ${error}`);
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

  /**
   * Clean up orphaned CLI containers that have state = "removed"
   * These are containers that no longer exist in Docker but still have database records
   */
  private async cleanupOrphanedCliContainers(hostId: string): Promise<void> {
    try {
      // Find CLI containers with "removed" state
      const orphanedCliContainers = await this.prisma.container.findMany({
        where: {
          hostId,
          isComposeManaged: false,
          state: 'removed',
        },
        select: {
          id: true,
          name: true,
          containerId: true,
        },
      });

      if (orphanedCliContainers.length === 0) {
        this.operationLogService.log('info', `No orphaned CLI containers found for cleanup on host ${hostId}`);
        return;
      }

      this.operationLogService.log('info', `Found ${orphanedCliContainers.length} orphaned CLI containers to clean up`);

      // Delete the orphaned CLI container records
      const deletedCount = await this.prisma.container.deleteMany({
        where: {
          id: { in: orphanedCliContainers.map(c => c.id) },
          isComposeManaged: false,
          state: 'removed',
        },
      });

      this.operationLogService.log('info',
        `Cleaned up ${deletedCount.count} orphaned CLI containers: ${orphanedCliContainers.map(c => c.name).join(', ')}`
      );

    } catch (error) {
      this.logger.error(`Failed to cleanup orphaned CLI containers: ${error}`);
      this.operationLogService.log('error', `Failed to cleanup orphaned CLI containers: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
