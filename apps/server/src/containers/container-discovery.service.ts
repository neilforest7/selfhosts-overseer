import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { FrpService } from '../frp/frp.service';
import { ReverseProxyService } from '../reverse-proxy/reverse-proxy.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { TasksService } from '../tasks/tasks.service';
import { ContextService } from '../context/context.service';

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

    // Extract ports, mounts, networks
    const ports = this.extractPorts(containerData);
    const mounts = this.extractMounts(containerData);
    const networks = this.extractNetworks(containerData);

    // Generate run command for CLI containers
    const runCommand = isComposeManaged ? null : this.generateRunCommand(containerData);

    await this.prisma.container.upsert({
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
        composeConfigFiles: composeConfigFiles ? { configFiles: composeConfigFiles.split(',') } : undefined,
        runCommand,
        ports,
        mounts,
        networks,
        labels,
      },
    });
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
}
