import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { FrpService } from '../frp/frp.service';
import { ReverseProxyService } from '../reverse-proxy/reverse-proxy.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { TasksService } from '../tasks/tasks.service';
import { ContextService } from '../context/context.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

@Injectable()
export class ContainerDiscoveryService {
  private readonly logger = new Logger(ContainerDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly frpService: FrpService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
    private readonly activityLog: ActivityLogService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    @Inject(forwardRef(() => ReverseProxyService))
    private readonly reverseProxyService: ReverseProxyService,
  ) {}

  async discover(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    console.log('--- DISCOVER METHOD CALLED ---', bodyHost);

    // Check if we're already running in an OperationLog context (e.g., from automation)
    const existingOpId = this.contextService.getOpId();

    if (existingOpId) {
      // We're already in a context, don't create a new OperationLog
      console.log(`Using existing OperationLog context: ${existingOpId}`);

      let targetHostIds: string[];

      if (bodyHost && (bodyHost as any).address && (bodyHost as any).sshUser && (bodyHost as any).id) {
        targetHostIds = [(bodyHost as any).id];
      } else {
        const hostId = bodyHost ? ((bodyHost as any).id as string | undefined) : undefined;
        if (!hostId || hostId === 'all') {
          const hosts = await this.prisma.host.findMany({ select: { id: true }, take: 1000 });
          targetHostIds = hosts.map(h => h.id);
        } else {
          targetHostIds = [hostId];
        }
      }

      await this.tasksService.exec({
        command: 'internal:discover_containers',
        targets: targetHostIds,
      });

      return { taskId: existingOpId };
    } else {
      // No existing context, create a new OperationLog
      const opLog = await this.operationLogService.create({ title: `Discover Containers` });

      return this.contextService.run(opLog.id, async () => {
        let targetHostIds: string[];

        if (bodyHost && (bodyHost as any).address && (bodyHost as any).sshUser && (bodyHost as any).id) {
          targetHostIds = [(bodyHost as any).id];
        } else {
          const hostId = bodyHost ? ((bodyHost as any).id as string | undefined) : undefined;
          if (!hostId || hostId === 'all') {
            const hosts = await this.prisma.host.findMany({ select: { id: true }, take: 1000 });
            targetHostIds = hosts.map(h => h.id);
          } else {
            targetHostIds = [hostId];
          }
        }

        await this.tasksService.exec({
          command: 'internal:discover_containers',
          targets: targetHostIds,
        });

        return { taskId: opLog.id };
      });
    }
  }

  async discoverMultiple(hostIds: string[]): Promise<{ taskId: string }> {
    console.log('--- DISCOVER MULTIPLE METHOD CALLED ---', hostIds);

    // Check if we're already running in an OperationLog context (e.g., from automation)
    const existingOpId = this.contextService.getOpId();

    if (existingOpId) {
      // We're already in a context, don't create a new OperationLog
      console.log(`Using existing OperationLog context: ${existingOpId}`);

      await this.tasksService.exec({
        command: 'internal:discover_containers',
        targets: hostIds,
      });

      return { taskId: existingOpId };
    } else {
      // No existing context, create a new OperationLog
      const hostNames = await this.prisma.host.findMany({
        where: { id: { in: hostIds } },
        select: { name: true }
      });
      const title = `Discover Containers (${hostNames.map(h => h.name).join(', ')})`;
      const opLog = await this.operationLogService.create({ title });

      return this.contextService.run(opLog.id, async () => {
        await this.tasksService.exec({
          command: 'internal:discover_containers',
          targets: hostIds,
        });

        return { taskId: opLog.id };
      });
    }
  }

  async discoverOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    console.log(`[ContainerDiscoveryService] Starting discovery on host ${host.address}`);
    this.operationLogService.log('info', `[${host.address}] Starting container discovery...`, host.id);

    try {
      const hostCred = await this.getHostCredById(host.id);
      if (!hostCred) throw new Error(`Host credentials not found for ${host.id}`);

      // Discover containers
      const { code, stdout, stderr } = await this.docker.exec(hostCred, ['ps', '-a', '--format', 'json'], 120);
      if (code !== 0) {
        throw new Error(`Failed to list containers: ${stderr}`);
      }

      const containerLines = stdout.trim().split('\n').filter(line => line.trim());
      const containerIds = containerLines
        .map(line => {
          try {
            const parsed = JSON.parse(line);
            return parsed.ID;
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      this.operationLogService.log('info', `[${host.address}] Found ${containerIds.length} containers`, host.id);

      // Process current containers
      if (containerIds.length > 0) {
        const inspectData = await this.docker.inspectContainers(hostCred, containerIds, 120);
        await this.processContainerData(host.id, inspectData);
      }

      // NOTE: Container cleanup is intentionally NOT performed during discovery
      // to prevent accidental deletion of containers. Only specific compose operations
      // should delete containers, and only for their own projects.

      // Sync FRP configurations
      await this.frpService.syncFrpFromHost(host.id);

      // Sync reverse proxy routes
      await this.reverseProxyService.syncRoutesFromHost(host.id);

      this.operationLogService.log('info', `[${host.address}] Container discovery completed`, host.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `[${host.address}] Discovery failed: ${errorMessage}`, host.id);
      throw error;
    }
  }

  private async processContainerData(hostId: string, inspectData: any[]): Promise<void> {
    for (const containerData of inspectData) {
      try {
        await this.upsertContainer(hostId, containerData);
      } catch (error) {
        this.logger.error(`Failed to process container ${containerData.Id}: ${error}`);
      }
    }
  }



  private async upsertContainer(hostId: string, containerData: any): Promise<void> {
    const containerId = containerData.Id;
    const name = containerData.Name?.replace(/^\//, '') || containerId.substring(0, 12);

    // Check for existing logical container before creating new record
    const existingContainer = await this.findExistingLogicalContainer(hostId, containerData);
    if (existingContainer && existingContainer.containerId !== containerId) {
      // Container ID changed - update existing record instead of creating new one
      await this.replaceContainerRecord(existingContainer, containerData);
      return;
    }
    
    // Extract container information
    const state = containerData.State?.Status || 'unknown';
    const status = containerData.State?.Status || 'unknown';
    const restartCount = containerData.RestartCount || 0;
    const createdAt = containerData.Created ? new Date(containerData.Created) : new Date();
    const startedAt = containerData.State?.StartedAt ? new Date(containerData.State.StartedAt) : null;

    // Extract image information
    const imageRef = containerData.Config?.Image || '';
    const [imageName, imageTag] = this.parseImageRef(imageRef);
    const repoDigests = containerData.RepoDigests || [];
    const repoDigest = repoDigests.length > 0 ? repoDigests[0] : null;

    // Extract compose information
    const labels = containerData.Config?.Labels || {};
    const composeProject = labels['com.docker.compose.project'];
    const composeService = labels['com.docker.compose.service'];
    const composeWorkingDir = labels['com.docker.compose.project.working_dir'];
    const composeConfigFiles = labels['com.docker.compose.project.config_files'];
    const isComposeManaged = Boolean(composeProject);

    // Generate compose metadata fields
    let composeGroupKey: string | null = null;
    let composeFolderName: string | null = null;

    if (isComposeManaged && composeProject) {
      // Generate composeGroupKey: hostId::compose::projectName
      composeGroupKey = `${hostId}::compose::${composeProject}`;

      // Generate composeFolderName from working directory
      if (composeWorkingDir) {
        const parts = composeWorkingDir.split(/[/\\]+/).filter(Boolean);
        composeFolderName = parts.length > 0 ? parts[parts.length - 1] : composeProject;
      } else {
        composeFolderName = composeProject;
      }
    }

    // Extract ports, mounts, networks
    const ports = this.extractPorts(containerData);
    const mounts = this.extractMounts(containerData);
    const networks = this.extractNetworks(containerData);

    // Generate run command for CLI containers
    const runCommand = isComposeManaged ? null : this.generateRunCommand(containerData);

    // Check if container exists for activity logging
    const existingContainerForLogging = await this.prisma.container.findUnique({
      where: { hostId_containerId: { hostId, containerId } },
    });

    const result = await this.prisma.container.upsert({
      where: { hostId_containerId: { hostId, containerId } },
      update: {
        name,
        state,
        status,
        restartCount,
        imageName,
        imageTag,
        repoDigest,
        startedAt,
        isComposeManaged,
        composeProject,
        composeService,
        composeWorkingDir,
        composeGroupKey,
        composeFolderName,
        composeConfigFiles: composeConfigFiles ? { configFiles: composeConfigFiles.split(',') } : undefined,
        runCommand,
        ports,
        mounts,
        networks,
        labels,
      },
      create: {
        hostId,
        containerId,
        name,
        state,
        status,
        restartCount,
        imageName,
        imageTag,
        repoDigest,
        createdAt,
        startedAt,
        isComposeManaged,
        composeProject,
        composeService,
        composeWorkingDir,
        composeGroupKey,
        composeFolderName,
        composeConfigFiles: composeConfigFiles ? { configFiles: composeConfigFiles.split(',') } : undefined,
        runCommand,
        ports,
        mounts,
        networks,
        labels,
      },
    });

    // Log activity
    const hostInfo = await this.prisma.host.findUnique({
      where: { id: hostId },
      select: { name: true },
    });

    if (!existingContainerForLogging) {
      // New container discovered
      await this.activityLog.logContainerActivity(
        'discovered',
        result.id,
        name,
        hostId,
        hostInfo?.name || 'Unknown Host',
        `Container '${name}' discovered`,
        `New container found: ${imageName}:${imageTag}`,
        {
          isComposeManaged,
          composeProject,
          composeService,
          imageName,
          imageTag,
          state,
          status,
        }
      );
    } else if (existingContainerForLogging.state !== state || existingContainerForLogging.status !== status) {
      // Container state changed
      await this.activityLog.logContainerActivity(
        'state_changed',
        result.id,
        name,
        hostId,
        hostInfo?.name || 'Unknown Host',
        `Container '${name}' state changed`,
        `State: ${existingContainerForLogging.state} → ${state}, Status: ${existingContainerForLogging.status} → ${status}`,
        {
          isComposeManaged,
          composeProject,
          composeService,
          imageName,
          imageTag,
          previousState: existingContainerForLogging.state,
          newState: state,
          previousStatus: existingContainerForLogging.status,
          newStatus: status,
        },
        {
          state: existingContainerForLogging.state,
          status: existingContainerForLogging.status,
        },
        {
          state,
          status,
        }
      );
    }
  }

  private parseImageRef(imageRef: string): [string, string] {
    if (!imageRef) return ['unknown', 'latest'];
    
    const lastColonIndex = imageRef.lastIndexOf(':');
    if (lastColonIndex === -1) {
      return [imageRef, 'latest'];
    }
    
    const beforeColon = imageRef.substring(0, lastColonIndex);
    const afterColon = imageRef.substring(lastColonIndex + 1);
    
    // Check if afterColon looks like a tag (not a digest)
    if (afterColon.includes('@') || afterColon.length > 20) {
      return [imageRef, 'latest'];
    }
    
    return [beforeColon, afterColon];
  }

  private extractPorts(containerData: any): any {
    const ports = containerData.NetworkSettings?.Ports || {};
    const result: any = {};
    
    for (const [containerPort, hostBindings] of Object.entries(ports)) {
      if (hostBindings && Array.isArray(hostBindings)) {
        result[containerPort] = hostBindings;
      }
    }
    
    return result;
  }

  private extractMounts(containerData: any): any {
    const mounts = containerData.Mounts || [];
    return mounts.map((mount: any) => ({
      Type: mount.Type,
      Source: mount.Source,
      Destination: mount.Destination,
      Mode: mount.Mode,
      RW: mount.RW,
    }));
  }

  private extractNetworks(containerData: any): any {
    const networks = containerData.NetworkSettings?.Networks || {};
    const result: any = {};
    
    for (const [networkName, networkData] of Object.entries(networks)) {
      result[networkName] = {
        IPAddress: (networkData as any)?.IPAddress,
        Gateway: (networkData as any)?.Gateway,
        MacAddress: (networkData as any)?.MacAddress,
      };
    }
    
    return result;
  }

  private generateRunCommand(containerData: any): string | null {
    try {
      const config = containerData.Config || {};
      const hostConfig = containerData.HostConfig || {};
      const name = containerData.Name?.replace(/^\//, '') || '';
      
      let cmd = `docker run -d --name ${name}`;
      
      // Add restart policy
      if (hostConfig.RestartPolicy?.Name) {
        cmd += ` --restart ${hostConfig.RestartPolicy.Name}`;
      }
      
      // Add port mappings
      const ports = containerData.NetworkSettings?.Ports || {};
      for (const [containerPort, hostBindings] of Object.entries(ports)) {
        if (hostBindings && Array.isArray(hostBindings)) {
          for (const binding of hostBindings) {
            if (binding.HostPort) {
              cmd += ` -p ${binding.HostPort}:${containerPort}`;
            }
          }
        }
      }
      
      // Add volume mounts
      const mounts = containerData.Mounts || [];
      for (const mount of mounts) {
        if (mount.Type === 'bind') {
          cmd += ` -v ${mount.Source}:${mount.Destination}`;
        } else if (mount.Type === 'volume') {
          cmd += ` -v ${mount.Name}:${mount.Destination}`;
        }
      }
      
      // Add environment variables
      const env = config.Env || [];
      for (const envVar of env) {
        if (!envVar.startsWith('PATH=') && !envVar.startsWith('HOME=')) {
          cmd += ` -e "${envVar}"`;
        }
      }
      
      // Add image
      cmd += ` ${config.Image}`;
      
      // Add command and args
      if (config.Cmd && config.Cmd.length > 0) {
        cmd += ` ${config.Cmd.join(' ')}`;
      }
      
      return cmd;
    } catch (error) {
      this.logger.warn(`Failed to generate run command: ${error}`);
      return null;
    }
  }

  private async getHostCredById(hostId: string) {
    const host = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!host) return null;

    return {
      address: host.address,
      sshUser: host.sshUser,
      port: host.port ?? undefined,
      password: host.sshPassword ? this.crypto.decryptString(host.sshPassword)?.toString() : undefined,
      privateKey: host.sshPrivateKey ? this.crypto.decryptString(host.sshPrivateKey)?.toString() : undefined,
      privateKeyPassphrase: host.sshPrivateKeyPassphrase ? this.crypto.decryptString(host.sshPrivateKeyPassphrase)?.toString() : undefined,
    };
  }

  private async findExistingLogicalContainer(hostId: string, containerData: any): Promise<any | null> {
    const name = containerData.Name?.replace(/^\//, '') || containerData.Id.substring(0, 12);

    // Extract compose information
    const labels = containerData.Config?.Labels || {};
    const composeProject = labels['com.docker.compose.project'];
    const composeService = labels['com.docker.compose.service'];

    if (composeProject && composeService) {
      // For compose containers: match by project + service
      const existing = await this.prisma.container.findFirst({
        where: {
          hostId,
          composeProject,
          composeService,
          isComposeManaged: true,
        },
      });

      if (existing) {
        this.operationLogService.log('info', `Found existing compose container: ${composeProject}/${composeService} (old ID: ${existing.containerId.substring(0, 12)}, new ID: ${containerData.Id.substring(0, 12)})`);
        return existing;
      }
    } else {
      // For CLI containers: match by name
      const existing = await this.prisma.container.findFirst({
        where: {
          hostId,
          name,
          isComposeManaged: false,
        },
      });

      if (existing && existing.containerId !== containerData.Id) {
        this.operationLogService.log('info', `Found existing CLI container: ${name} (old ID: ${existing.containerId.substring(0, 12)}, new ID: ${containerData.Id.substring(0, 12)})`);
        return existing;
      }
    }

    return null;
  }

  private async replaceContainerRecord(existingContainer: any, newContainerData: any): Promise<void> {
    const newContainerId = newContainerData.Id;
    const name = newContainerData.Name?.replace(/^\//, '') || newContainerId.substring(0, 12);

    try {
      // Extract all the container information (same as upsertContainer logic)
      const state = newContainerData.State?.Status || 'unknown';
      const status = newContainerData.State?.Status || 'unknown';
      const restartCount = newContainerData.RestartCount || 0;
      const startedAt = newContainerData.State?.StartedAt ? new Date(newContainerData.State.StartedAt) : null;

      // Extract image information
      const imageWithTag = newContainerData.Config?.Image || newContainerData.Image || '';
      const [imageName, imageTag] = this.parseImageRef(imageWithTag);
      const repoDigest = newContainerData.RepoDigests?.[0] || null;

      // Extract compose information
      const labels = newContainerData.Config?.Labels || {};
      const composeProject = labels['com.docker.compose.project'] || null;
      const composeService = labels['com.docker.compose.service'] || null;
      const composeWorkingDir = labels['com.docker.compose.project.working_dir'] || null;
      const isComposeManaged = !!(composeProject && composeService);

      // Generate compose group key and folder name
      const composeGroupKey = isComposeManaged ? `${composeProject}_${composeService}` : null;
      const composeFolderName = composeWorkingDir ? composeWorkingDir.split('/').pop() || null : null;

      // Extract compose config files
      const composeConfigFiles = labels['com.docker.compose.project.config_files'];

      // Generate run command for CLI containers
      const runCommand = !isComposeManaged ? this.generateRunCommand(newContainerData) : null;

      // Extract networking and storage information
      const ports = this.extractPorts(newContainerData);
      const mounts = this.extractMounts(newContainerData);
      const networks = this.extractNetworks(newContainerData);

      // Update the existing record with new container ID and data
      await this.prisma.container.update({
        where: { id: existingContainer.id },
        data: {
          containerId: newContainerId,
          name,
          state,
          status,
          restartCount,
          imageName,
          imageTag,
          repoDigest,
          startedAt,
          isComposeManaged,
          composeProject,
          composeService,
          composeWorkingDir,
          composeGroupKey,
          composeFolderName,
          composeConfigFiles: composeConfigFiles ? { configFiles: composeConfigFiles.split(',') } : undefined,
          runCommand,
          ports,
          mounts,
          networks,
          labels,
          // Preserve user-configured fields like manualPortMapping
        },
      });

      this.operationLogService.log('info', `Successfully replaced container record for "${name}" with new container ID: ${newContainerId.substring(0, 12)}`);
    } catch (error) {
      this.logger.error(`Failed to replace container record for ${existingContainer.name}: ${error}`);
      this.operationLogService.log('error', `Failed to replace container record: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}
