import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { TasksService } from '../tasks/tasks.service';
import { ContextService } from '../context/context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ContainerComposeService {
  private readonly logger = new Logger(ContainerComposeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
  ) {}

  async operate(
    hostOrRef: { id: string },
    operation: 'up' | 'down' | 'restart' | 'pull' | 'stop' | 'start',
    project: string,
    workingDir: string,
    services?: string[],
  ): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({
      title: `Compose ${operation.toUpperCase()} - ${project}${services ? ` (${services.join(', ')})` : ''}`,
    });

    // Execute the operation asynchronously but don't wait for it to complete
    // This allows the API to return immediately while the operation runs in the background
    setImmediate(async () => {
      await this.contextService.run(opLog.id, async () => {
        let isFailed = false;
        try {
          const hostCred = await this.getHostCredById(hostOrRef.id);
          if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

          await this.executeComposeOperation(hostCred, operation, project, workingDir, services);

          // Refresh container status after operation
          this.operationLogService.log('info', `Refreshing container status for project "${project}"...`);
          await this.refreshComposeProjectStatus(hostOrRef.id, project, operation);

          // Add a small delay to ensure status is fully updated before frontend queries
          await new Promise(resolve => setTimeout(resolve, 1000));
          this.operationLogService.log('info', `Status refresh completed for project "${project}"`);

          // Emit an event to notify that the operation is truly complete
          this.eventEmitter.emit('compose.operation.completed', {
            hostId: hostOrRef.id,
            project,
            operation,
            taskId: opLog.id
          });
        } catch (err) {
          isFailed = true;
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.logger.error(`Compose ${operation} failed for project "${project}": ${errorMessage}`, err instanceof Error ? err.stack : undefined);
          this.operationLogService.log('error', `Compose ${operation} failed: ${errorMessage}`);
        } finally {
          await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
        }
      });
    });

    return { taskId: opLog.id };
  }

  async getComposeConfig(hostOrRef: { id: string }, project: string, workingDir: string): Promise<any> {
    const hostCred = await this.getHostCredById(hostOrRef.id);
    if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

    const args = ['compose', '--project-directory', workingDir, '-p', project, 'config'];
    const { code, stdout, stderr } = await this.docker.exec(hostCred, args, 60);

    if (code !== 0) {
      throw new Error(`Failed to get compose config: ${stderr}`);
    }

    try {
      // Parse YAML output (you might want to use a YAML parser library)
      return { config: stdout };
    } catch (error) {
      throw new Error(`Failed to parse compose config: ${error}`);
    }
  }

  async listComposeProjects(hostOrRef: { id: string }): Promise<any[]> {
    const hostCred = await this.getHostCredById(hostOrRef.id);
    if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

    const projects = await this.docker.composeLs(hostCred, 60);
    return projects;
  }

  async getComposeServices(hostOrRef: { id: string }, project: string, workingDir: string): Promise<string[]> {
    const hostCred = await this.getHostCredById(hostOrRef.id);
    if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

    const args = ['compose', '--project-directory', workingDir, '-p', project, 'config', '--services'];
    const { code, stdout, stderr } = await this.docker.exec(hostCred, args, 60);

    if (code !== 0) {
      throw new Error(`Failed to get compose services: ${stderr}`);
    }

    return stdout.trim().split('\n').filter(service => service.trim());
  }

  async getComposeStatus(hostOrRef: { id: string }, project: string, _workingDir: string): Promise<any[]> {
    const hostCred = await this.getHostCredById(hostOrRef.id);
    if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

    const containers = await this.docker.psByComposeProject(hostCred, project, 60);
    return containers;
  }

  async pullComposeImages(hostOrRef: { id: string }, project: string, workingDir: string, services?: string[]): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({
      title: `Pull Compose Images - ${project}${services ? ` (${services.join(', ')})` : ''}`,
    });

    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const hostCred = await this.getHostCredById(hostOrRef.id);
        if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

        this.operationLogService.log('info', `Pulling images for compose project "${project}"...`);

        const args = ['compose', '--project-directory', workingDir, '-p', project, 'pull'];
        if (services && services.length > 0) {
          args.push(...services);
        }

        const { code, stderr } = await this.docker.execStreaming(hostCred, args, 600);

        if (code !== 0) {
          throw new Error(`Failed to pull compose images: ${stderr}`);
        }

        this.operationLogService.log('info', `Images pulled successfully for project "${project}"`);
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Pull failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });

    return { taskId: opLog.id };
  }

  async restartComposeProject(hostOrRef: { id: string }, project: string, workingDir: string, services?: string[]): Promise<{ taskId: string }> {
    return this.operate(hostOrRef, 'restart', project, workingDir, services);
  }

  async stopComposeProject(hostOrRef: { id: string }, project: string, workingDir: string, services?: string[]): Promise<{ taskId: string }> {
    return this.operate(hostOrRef, 'stop', project, workingDir, services);
  }

  async downComposeProject(hostOrRef: { id: string }, project: string, workingDir: string, services?: string[]): Promise<{ taskId: string }> {
    return this.operate(hostOrRef, 'down', project, workingDir, services);
  }

  async startComposeProject(hostOrRef: { id: string }, project: string, workingDir: string, services?: string[]): Promise<{ taskId: string }> {
    return this.operate(hostOrRef, 'start', project, workingDir, services);
  }

  async upComposeProject(hostOrRef: { id: string }, project: string, workingDir: string, services?: string[]): Promise<{ taskId: string }> {
    return this.operate(hostOrRef, 'up', project, workingDir, services);
  }

  /**
   * Start a compose project that was previously marked as compose-down
   * This method specifically handles reactivating preserved container records
   */
  async reactivateComposeProject(hostOrRef: { id: string }, project: string, workingDir: string): Promise<{ taskId: string }> {
    // Check if there are compose-down containers for this project
    const composeDownContainers = await this.prisma.container.findMany({
      where: {
        hostId: hostOrRef.id,
        composeProject: project,
        state: 'compose-down',
        isComposeManaged: true,
      },
    });

    if (composeDownContainers.length === 0) {
      throw new Error(`No compose-down containers found for project "${project}"`);
    }

    this.logger.log(`Reactivating compose project "${project}" with ${composeDownContainers.length} preserved containers`);

    // Use the regular up operation, which will handle the reactivation
    return this.operate(hostOrRef, 'up', project, workingDir);
  }

  private async executeComposeOperation(
    hostCred: any,
    operation: 'up' | 'down' | 'restart' | 'pull' | 'stop' | 'start',
    project: string,
    workingDir: string,
    services?: string[],
  ): Promise<void> {
    this.operationLogService.log('info', `Executing compose ${operation} for project "${project}"...`);
    this.operationLogService.log('info', `Working directory: ${workingDir}`);
    this.operationLogService.log('info', `Host: ${hostCred.address} (${hostCred.sshUser})`);

    let args: string[];

    switch (operation) {
      case 'up':
        args = ['compose', '--project-directory', workingDir, '-p', project, 'up', '-d'];
        break;
      case 'down':
        args = ['compose', '--project-directory', workingDir, '-p', project, 'down'];
        break;
      case 'start':
        args = ['compose', '--project-directory', workingDir, '-p', project, 'start'];
        break;
      case 'stop':
        args = ['compose', '--project-directory', workingDir, '-p', project, 'stop'];
        break;
      case 'restart':
        args = ['compose', '--project-directory', workingDir, '-p', project, 'restart'];
        break;
      case 'pull':
        args = ['compose', '--project-directory', workingDir, '-p', project, 'pull'];
        break;
      default:
        throw new Error(`Unsupported operation: ${operation}`);
    }

    if (services && services.length > 0) {
      args.push(...services);
      this.operationLogService.log('info', `Target services: ${services.join(', ')}`);
    }

    const dockerCommand = `docker ${args.join(' ')}`;
    this.operationLogService.log('info', `Executing command: ${dockerCommand}`);

    try {
      const { code, stdout, stderr, cmd } = await this.docker.execStreaming(hostCred, args, 600);

      // Log the actual command that was executed
      this.operationLogService.log('info', `Executed: ${cmd}`);

      // Log stdout if available
      if (stdout && stdout.trim()) {
        this.operationLogService.log('stdout', stdout.trim());
      }

      // Log stderr even if command succeeded (Docker often outputs info to stderr)
      if (stderr && stderr.trim()) {
        this.operationLogService.log('stderr', stderr.trim());
      }

      if (code !== 0) {
        const errorMsg = `Compose ${operation} failed with exit code ${code}`;
        this.operationLogService.log('error', errorMsg);
        if (stderr) {
          this.operationLogService.log('error', `Error output: ${stderr}`);
        }
        throw new Error(`${errorMsg}: ${stderr || 'No error output'}`);
      }

      this.operationLogService.log('info', `Compose ${operation} completed successfully for project "${project}"`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Docker execution failed: ${errorMessage}`);
      throw error;
    }
  }

  async getComposeProjectContainers(hostId: string, project: string): Promise<any[]> {
    const containers = await this.prisma.container.findMany({
      where: {
        hostId,
        composeProject: project,
        isComposeManaged: true,
      },
      orderBy: { composeService: 'asc' },
    });

    return containers;
  }

  /**
   * Get all compose projects that have containers in compose-down state
   * This is useful for UI to show which projects can be reactivated
   */
  async getComposeDownProjects(hostId?: string): Promise<Array<{
    hostId: string;
    hostName: string;
    project: string;
    workingDir: string;
    containerCount: number;
    downSince: Date;
  }>> {
    const whereClause: any = {
      state: 'compose-down',
      isComposeManaged: true,
      composeProject: { not: null },
    };

    if (hostId) {
      whereClause.hostId = hostId;
    }

    const composeDownContainers = await this.prisma.container.findMany({
      where: whereClause,
      include: {
        host: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by project and host
    const projectMap = new Map<string, {
      hostId: string;
      hostName: string;
      project: string;
      workingDir: string;
      containers: any[];
      latestUpdate: Date;
    }>();

    for (const container of composeDownContainers) {
      const key = `${container.hostId}-${container.composeProject}`;

      if (!projectMap.has(key)) {
        projectMap.set(key, {
          hostId: container.hostId,
          hostName: container.host.name,
          project: container.composeProject!,
          workingDir: container.composeWorkingDir || '',
          containers: [],
          latestUpdate: container.createdAt,
        });
      }

      const project = projectMap.get(key)!;
      project.containers.push(container);

      // Keep track of the most recent creation time (approximation for when it was marked as compose-down)
      if (container.createdAt > project.latestUpdate) {
        project.latestUpdate = container.createdAt;
      }
    }

    return Array.from(projectMap.values()).map(project => ({
      hostId: project.hostId,
      hostName: project.hostName,
      project: project.project,
      workingDir: project.workingDir,
      containerCount: project.containers.length,
      downSince: project.latestUpdate,
    }));
  }

  async updateComposeProjectStatus(hostId: string, project: string, operation?: 'up' | 'down' | 'restart' | 'pull' | 'stop' | 'start'): Promise<void> {
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

      this.operationLogService.log('info', `Found ${currentContainers.length} current containers and ${dbContainers.length} database containers for project "${project}"`);

      // Update existing containers
      if (currentContainers.length > 0) {
        const containerIds = currentContainers.map(c => c.ID).filter(Boolean);
        if (containerIds.length > 0) {
          const inspectData = await this.docker.inspectContainers(hostCred, containerIds, 120);
          await this.updateContainerData(hostId, inspectData);
          this.operationLogService.log('info', `Updated ${inspectData.length} existing containers for project "${project}"`);
        }
      }

      // Handle removed containers - mark as exited or delete them
      const removedContainers = dbContainers.filter(dbContainer =>
        !currentContainerIds.has(dbContainer.containerId)
      );

      if (removedContainers.length > 0) {
        this.operationLogService.log('info', `Found ${removedContainers.length} containers not in current Docker output for project "${project}"`);

        // Handle different scenarios based on operation type
        if (operation === 'down') {
          // For 'down' operations, preserve container records but mark them as compose-down
          // This allows users to restart the compose project from the UI
          this.operationLogService.log('info', `Marking ${removedContainers.length} containers as compose-down (preserving records for UI restart)`);
          const removedContainerIds = removedContainers.map(c => c.id);
          await this.prisma.container.updateMany({
            where: {
              id: { in: removedContainerIds },
            },
            data: {
              state: 'compose-down',
              status: 'compose-down',
              startedAt: null,
              // Preserve all other fields including user configurations
            },
          });
          this.operationLogService.log('info', `Marked ${removedContainers.length} containers as compose-down: ${removedContainers.map(c => c.name).join(', ')}`);
        } else if (operation === 'up') {
          // For 'up' operations, containers might have been recreated with new IDs
          // Also handle reactivation of compose-down containers
          await this.handleContainerRecreation(hostId, project, removedContainers, currentContainers);
        } else {
          // For start/stop/restart operations, containers should still exist
          // This might indicate a temporary issue or containers in a different state
          this.operationLogService.log('info', `Containers missing from Docker output during '${operation}' operation. This might be temporary. Containers: ${removedContainers.map(c => c.name).join(', ')}`);
        }
      }

    } catch (error) {
      this.logger.error(`Failed to update compose project status for ${project}: ${error}`);
      this.operationLogService.log('error', `Failed to update compose project status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async updateContainerData(hostId: string, inspectData: any[]): Promise<void> {
    for (const containerData of inspectData) {
      try {
        await this.upsertContainerFromInspectData(hostId, containerData);
      } catch (error) {
        this.logger.error(`Failed to update container ${containerData.Id}: ${error}`);
      }
    }
  }

  private async upsertContainerFromInspectData(hostId: string, containerData: any): Promise<void> {
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
    const isComposeManaged = !!composeProject;

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

    // Extract runtime information
    const ports = this.extractPorts(containerData);
    const mounts = this.extractMounts(containerData);
    const networks = this.extractNetworks(containerData);

    // Generate run command for CLI containers
    const runCommand = isComposeManaged ? null : this.generateRunCommand(containerData);

    // Use upsert to handle both new containers and container recreation scenarios
    // This preserves user-configured fields like manualPortMapping
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
        composeGroupKey,
        composeFolderName,
        composeConfigFiles: composeConfigFiles ? { configFiles: composeConfigFiles.split(',') } : undefined,
        runCommand,
        ports,
        mounts,
        networks,
        labels,
        // Note: manualPortMapping is intentionally NOT updated here to preserve user settings
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
        // manualPortMapping will be null for new containers
      },
    });
  }

  private async refreshComposeProjectStatus(hostId: string, project: string, operation: 'up' | 'down' | 'restart' | 'pull' | 'stop' | 'start') {
    // Trigger a status refresh for the compose project
    await this.updateComposeProjectStatus(hostId, project, operation);
  }

  // Helper methods for container data extraction (copied from ContainerDiscoveryService)
  private parseImageRef(imageRef: string): [string, string] {
    if (!imageRef) return ['', 'latest'];

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
    // For compose-managed containers, we don't generate run commands
    const labels = containerData.Config?.Labels || {};
    if (labels['com.docker.compose.project']) {
      return null;
    }

    // Basic run command generation (simplified version)
    const name = containerData.Name?.replace(/^\//, '') || '';
    const image = containerData.Config?.Image || '';

    let cmd = `docker run --name ${name}`;

    // Add restart policy
    const restartPolicy = containerData.HostConfig?.RestartPolicy?.Name;
    if (restartPolicy && restartPolicy !== 'no') {
      cmd += ` --restart ${restartPolicy}`;
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

    // Add volumes
    const mounts = containerData.Mounts || [];
    for (const mount of mounts) {
      if (mount.Type === 'bind') {
        cmd += ` -v ${mount.Source}:${mount.Destination}`;
      } else if (mount.Type === 'volume') {
        cmd += ` -v ${mount.Name}:${mount.Destination}`;
      }
    }

    cmd += ` ${image}`;

    return cmd;
  }

  /**
   * Handle container recreation scenarios where containers have new IDs but same names/services
   * This preserves user-configured data like manualPortMapping and handles compose-down containers
   */
  private async handleContainerRecreation(
    hostId: string,
    project: string,
    removedContainers: Array<{id: string, containerId: string, name: string}>,
    currentContainers: any[]
  ): Promise<void> {
    this.operationLogService.log('info', `Checking for container recreation scenarios in project "${project}"`);

    // Track which current containers have been matched to avoid duplicate assignments
    const matchedCurrentContainerIds = new Set<string>();

    for (const removedContainer of removedContainers) {
      // Get the old container's data first to check its state
      const oldContainerData = await this.prisma.container.findUnique({
        where: { id: removedContainer.id },
        select: {
          manualPortMapping: true,
          state: true,
          status: true,
          composeService: true,
          composeProject: true,
          // Add other user-configured fields here if needed
        },
      });

      if (!oldContainerData) {
        this.operationLogService.log('info', `Container record not found for "${removedContainer.name}", skipping`);
        continue;
      }

      const wasComposeDown = oldContainerData.state === 'compose-down';

      // For compose-down containers during 'up' operation, we need to find the matching new container
      // by service name rather than container name, as container names might differ
      let matchingCurrentContainer = null;

      if (wasComposeDown && oldContainerData.composeService) {
        // Try to match by compose service name first (more reliable for compose-down reactivation)
        // For containers on the same host with the same service name, we consider them as matching
        matchingCurrentContainer = currentContainers.find(current => {
          // Skip if this container has already been matched
          if (matchedCurrentContainerIds.has(current.ID)) {
            return false;
          }
          const currentLabels = current.Labels || {};
          const currentService = currentLabels['com.docker.compose.service'];
          return currentService === oldContainerData.composeService;
        });

        if (matchingCurrentContainer) {
          this.operationLogService.log('info', `Found matching container for compose-down service "${oldContainerData.composeService}": ${matchingCurrentContainer.ID}`);
        }
      }

      // Fallback: try to match by container name or service name patterns
      if (!matchingCurrentContainer) {
        matchingCurrentContainer = currentContainers.find(current => {
          // Skip if this container has already been matched
          if (matchedCurrentContainerIds.has(current.ID)) {
            return false;
          }

          const currentName = current.Names?.[0]?.replace(/^\//, '') || current.ID?.substring(0, 12);
          const currentLabels = current.Labels || {};
          const currentService = currentLabels['com.docker.compose.service'];

          this.operationLogService.log('info', `Fallback: Checking container "${currentName}" (service: ${currentService}) against removed "${removedContainer.name}"`);

          // Try multiple matching strategies:
          // 1. Exact name match
          if (currentName === removedContainer.name) {
            this.operationLogService.log('info', `Matched by exact name: ${currentName} === ${removedContainer.name}`);
            return true;
          }

          // 2. Service name match (if available)
          if (currentService && currentService === removedContainer.name) {
            this.operationLogService.log('info', `Matched by service name: ${currentService} === ${removedContainer.name}`);
            return true;
          }

          // 3. Check if current name contains the removed name or vice versa
          if (currentName.includes(removedContainer.name) || removedContainer.name.includes(currentName)) {
            this.operationLogService.log('info', `Matched by name pattern: "${currentName}" <-> "${removedContainer.name}"`);
            return true;
          }

          // 4. For compose-down containers, try to match by service name from old data
          if (wasComposeDown && oldContainerData.composeService && currentService === oldContainerData.composeService) {
            this.operationLogService.log('info', `Matched by compose service: ${currentService} === ${oldContainerData.composeService}`);
            return true;
          }

          return false;
        });
      }

      if (matchingCurrentContainer) {
        this.operationLogService.log('info', `Container "${removedContainer.name}" was recreated with new ID: ${removedContainer.containerId} -> ${matchingCurrentContainer.ID}`);

        // Mark this current container as matched to prevent duplicate assignments
        matchedCurrentContainerIds.add(matchingCurrentContainer.ID);

        if (wasComposeDown) {
          this.operationLogService.log('info', `Reactivating compose-down container "${removedContainer.name}" with new ID: ${matchingCurrentContainer.ID}`);

          // Update the existing record with the new container ID instead of deleting
          await this.prisma.container.update({
            where: { id: removedContainer.id },
            data: {
              containerId: matchingCurrentContainer.ID,
              // The upsert process will update other fields, but we preserve user config
            },
          });
        } else {
          // Normal recreation scenario - delete old record
          await this.prisma.container.delete({
            where: { id: removedContainer.id },
          });
        }

        // The new container will be created/updated by the normal upsert process
        // but we need to preserve the user data after it's created
        if (oldContainerData.manualPortMapping) {
          // Wait a moment for the upsert to complete, then update with preserved data
          setTimeout(async () => {
            try {
                await this.prisma.container.updateMany({
                  where: {
                    hostId,
                    containerId: matchingCurrentContainer.ID,
                  },
                  data: {
                    manualPortMapping: oldContainerData.manualPortMapping as any,
                  },
                });
                this.operationLogService.log('info', `Preserved user configuration for ${wasComposeDown ? 'reactivated' : 'recreated'} container "${removedContainer.name}"`);
              } catch (error) {
                this.logger.error(`Failed to preserve user configuration for container ${removedContainer.name}: ${error}`);
              }
          }, 1000);
        }
      } else {
        // No matching current container found
        if (wasComposeDown) {
          // This is a compose-down container that wasn't reactivated
          // This could happen if the compose up operation failed or only started some services
          this.operationLogService.log('info', `Compose-down container "${removedContainer.name}" was not reactivated (no matching running container found)`);
          // Keep the compose-down record as is
        } else {
          // Container was truly removed, not recreated
          this.operationLogService.log('info', `Container "${removedContainer.name}" was removed (not recreated)`);
          await this.prisma.container.delete({
            where: { id: removedContainer.id },
          });
        }
      }
    }

    // Clean up historical compose-down records after successful container recreation
    await this.cleanupHistoricalComposeDownRecords(hostId, project);
  }

  /**
   * Clean up historical compose-down container records for a specific project
   * This prevents database accumulation of old records while preserving active containers
   */
  private async cleanupHistoricalComposeDownRecords(hostId: string, project: string): Promise<void> {
    try {
      // Find all compose-down records for this project
      const composeDownContainers = await this.prisma.container.findMany({
        where: {
          hostId,
          composeProject: project,
          state: 'compose-down',
          isComposeManaged: true,
        },
        select: {
          id: true,
          name: true,
          containerId: true,
        },
      });

      if (composeDownContainers.length === 0) {
        this.operationLogService.log('info', `No compose-down records to clean up for project "${project}"`);
        return;
      }

      this.operationLogService.log('info', `Found ${composeDownContainers.length} compose-down records to clean up for project "${project}"`);

      // Get current running containers for this project to ensure we don't delete active records
      const host = await this.prisma.host.findUnique({ where: { id: hostId } });
      if (!host) {
        this.operationLogService.log('error', `Host not found for cleanup: ${hostId}`);
        return;
      }

      const hostCred = await this.getHostCredById(hostId);
      if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

      const currentContainers = await this.docker.psByComposeProject(hostCred, project);
      const currentContainerIds = new Set(currentContainers.map((c: any) => c.ID));

      // Filter out any compose-down records that somehow correspond to currently running containers
      const safeToDeleteRecords = composeDownContainers.filter(record => {
        const isCurrentlyRunning = currentContainerIds.has(record.containerId);
        if (isCurrentlyRunning) {
          this.operationLogService.log('info', `Skipping deletion of compose-down record "${record.name}" as container ${record.containerId} is currently running`);
          return false;
        }
        return true;
      });

      if (safeToDeleteRecords.length === 0) {
        this.operationLogService.log('info', `No safe-to-delete compose-down records found for project "${project}"`);
        return;
      }

      // Delete the historical compose-down records
      const recordIdsToDelete = safeToDeleteRecords.map(r => r.id);
      const deletedCount = await this.prisma.container.deleteMany({
        where: {
          id: { in: recordIdsToDelete },
          state: 'compose-down', // Extra safety check
        },
      });

      this.operationLogService.log('info', `Cleaned up ${deletedCount.count} historical compose-down records for project "${project}": ${safeToDeleteRecords.map(r => r.name).join(', ')}`);

    } catch (error) {
      this.logger.error(`Failed to clean up historical compose-down records for project ${project}: ${error}`);
      this.operationLogService.log('error', `Failed to clean up historical records: ${error instanceof Error ? error.message : String(error)}`);
      // Don't throw - cleanup failure shouldn't break the main operation
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
