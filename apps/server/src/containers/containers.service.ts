import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { DiunService } from '../diun/diun.service';
import { FrpService } from '../frp/frp.service';
import { ReverseProxyService } from '../reverse-proxy/reverse-proxy.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ExecGateway } from '../realtime/exec.gateway';
import { LogsService } from '../logs/logs.service';
import { UpdateManualPortDto } from './dto/manual-port.dto';
import { TasksService } from '../tasks/tasks.service';
import { Prisma } from '@prisma/client';
import { ContextService } from '../context/context.service';

@Injectable()
export class ContainersService {
  private readonly logger = new Logger(ContainersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly diun: DiunService,
    private readonly frpService: FrpService,
    private readonly operationLogService: OperationLogService,
    private readonly gateway: ExecGateway,
    private readonly logs: LogsService,
    private readonly contextService: ContextService,
    @Inject(forwardRef(() => TasksService))
    private readonly tasksService: TasksService,
    @Inject(forwardRef(() => ReverseProxyService))
    private readonly reverseProxyService: ReverseProxyService,
  ) {}

  async list(params: { hostId?: string; hostName?: string; q?: string; updateAvailable?: boolean | undefined; isComposeManaged?: boolean | undefined }) {
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

  async discoverOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    try {
      this.operationLogService.log('system', `Starting container discovery on host ${host.address}`, host.id);

      const h = await this.prisma.host.findUnique({ where: { id: host.id } });
      if (!h) throw new Error('Host not found in database.');

      const decPassword = this.crypto.decryptString(h.sshPassword)?.toString();
      const decKey = this.crypto.decryptString(h.sshPrivateKey)?.toString();
      const decPassphrase = this.crypto.decryptString(h.sshPrivateKeyPassphrase)?.toString();
      const hostCred = { ...host, password: decPassword, privateKey: decKey, privateKeyPassphrase: decPassphrase } as any;

      // 1. Get detailed status from `docker ps`
      const { code, stdout, stderr } = await this.docker.execStreaming(hostCred, ['ps', '-a', '--format', '{{json .}}']);
      if (code !== 0) {
        throw new Error(`'docker ps -a' failed with exit code ${code}: ${stderr}`);
      }

      const psOutputLines = stdout.split('\n').filter(Boolean);
      const psStatusMap = new Map<string, string>();
      const onlineContainerIds: string[] = [];
      for (const line of psOutputLines) {
        try {
          const containerInfo = JSON.parse(line);
          psStatusMap.set(containerInfo.ID, containerInfo.Status);
          onlineContainerIds.push(containerInfo.ID);
        } catch (e) {
          this.operationLogService.log('info', `Could not parse docker ps JSON line: ${line}`, host.id);
        }
      }

      if (onlineContainerIds.length === 0) {
        this.operationLogService.log('system', 'No containers found on the host. Marking all existing DB entries as exited.', host.id);
        await this.prisma.container.updateMany({ where: { hostId: host.id }, data: { state: 'exited', status: 'exited' } });
        return;
      }

      this.operationLogService.log('info', `Found ${onlineContainerIds.length} online containers. Inspecting details...`, host.id);
      const onlineContainersDetails = await this.docker.inspectContainers(hostCred, onlineContainerIds);
      const onlineContainerIdsSet = new Set(onlineContainersDetails.map(d => d.Id));

      const upsertOperations = [];
      for (const det of onlineContainersDetails) {
        const containerName = det.Name.startsWith('/') ? det.Name.substring(1) : det.Name;
        const labels = det.Config.Labels || {};
        const composeProject = labels['com.docker.compose.project'] || null;
        const composeService = labels['com.docker.compose.service'] || null;
        const isCompose = !!(composeProject && composeService);
        const composeWorkingDir = labels['com.docker.compose.project.working_dir'] || null;
        const composeFolderName = (() => {
          if (!composeWorkingDir) return composeProject;
          const parts = composeWorkingDir.split(/[/]+/).filter(Boolean);
          return parts.length ? parts[parts.length - 1] : composeProject;
        })();
        const composeConfigFilesRaw = labels['com.docker.compose.project.config_files'];
        const composeConfigFiles = composeConfigFilesRaw ? String(composeConfigFilesRaw).split(',') : null;

        const { imageName, imageTag } = await this.docker.resolveImageNameTag(hostCred, det.Config.Image);
        const repoDigest = await this.docker.getContainerImageDigest(hostCred, det.Id);

        const commonData = {
          name: containerName,
          state: det.State.Status, // Raw status from inspect
          status: psStatusMap.get(det.Id) || det.State.Status, // User-friendly status from ps
          imageName,
          imageTag,
          repoDigest,
          startedAt: new Date(det.State.StartedAt),
          ports: det.NetworkSettings.Ports as any,
          mounts: det.Mounts as any,
          networks: det.NetworkSettings.Networks as any,
          labels: labels as any,
          isComposeManaged: isCompose,
          composeProject,
          composeService,
          composeWorkingDir,
          composeFolderName,
          composeConfigFiles: composeConfigFiles as any,
          composeGroupKey: composeProject ? `${host.id}::compose::${composeProject}` : null,
          runCommand: !isCompose ? await this.generateRunCommand(det, containerName) : undefined,
        };

        upsertOperations.push(
          this.prisma.container.upsert({
            where: { hostId_containerId: { hostId: host.id, containerId: det.Id } },
            update: commonData,
            create: { hostId: host.id, containerId: det.Id, ...commonData },
          }),
        );
      }
      await this.prisma.$transaction(upsertOperations);
      this.operationLogService.log('info', `Synchronized ${onlineContainersDetails.length} online container records.`, host.id);

      const allHostContainersInDb = await this.prisma.container.findMany({ where: { hostId: host.id } });
      const logicalKeyToContainers = new Map<string, any[]>();

      for (const c of allHostContainersInDb) {
        const logicalKey = c.isComposeManaged ? `compose_${c.composeProject}_${c.composeService}` : `cli_${c.name}`;

        if (!logicalKeyToContainers.has(logicalKey)) {
          logicalKeyToContainers.set(logicalKey, []);
        }
        logicalKeyToContainers.get(logicalKey)?.push(c);
      }

      const idsToDelete = [];
      for (const containers of logicalKeyToContainers.values()) {
        if (containers.length > 1) {
          const onlineContainer = containers.find(c => onlineContainerIdsSet.has(c.containerId));
          if (onlineContainer) {
            const staleContainers = containers.filter(c => c.id !== onlineContainer.id);
            idsToDelete.push(...staleContainers.map(c => c.id));
          }
        }
      }

      if (idsToDelete.length > 0) {
        await this.prisma.container.deleteMany({ where: { id: { in: idsToDelete } } });
        this.operationLogService.log('info', `Deleted ${idsToDelete.length} stale duplicate container records.`, host.id);
      }

      const finalDbContainerIds = new Set(
        (await this.prisma.container.findMany({ where: { hostId: host.id }, select: { containerId: true } })).map(
          c => c.containerId,
        ),
      );
      const containersToMarkExited = [...finalDbContainerIds].filter(id => !onlineContainerIdsSet.has(id));

      if (containersToMarkExited.length > 0) {
        await this.prisma.container.updateMany({
          where: { hostId: host.id, containerId: { in: containersToMarkExited } },
          data: { state: 'exited', status: 'exited' },
        });
        this.operationLogService.log('info', `Marked ${containersToMarkExited.length} missing containers as exited.`, host.id);
      }

      await this.frpService.syncFrpFromHost(host.id);
      await this.reverseProxyService.syncRoutesFromHost(host.id);

      this.operationLogService.log('system', 'Container discovery finished successfully.', host.id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.operationLogService.log('error', `Discovery failed: ${errorMessage}`, host.id);
    }
  }

  async discover(bodyHost?: { id?: string; address?: string; sshUser?: string; port?: number } | { id: 'all' }): Promise<{ taskId: string }> {
    console.log('--- DISCOVER METHOD CALLED ---');

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

  async checkUpdates(host: { id: string; address: string; sshUser: string; port?: number }): Promise<{ updated: number }> {
    this.operationLogService.log('info', `[${host.address}] Starting update check with diun...`, host.id);
    const updatedCount = await this.diun.checkUpdatesForHost(host.id);
    this.operationLogService.log('info', `[${host.address}] Diun check finished, found ${updatedCount} updates.`, host.id);
    return { updated: updatedCount };
  }

  async checkSingleContainerUpdate(containerId: string): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Check Update for Container ${containerId}` });
    return this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({ where: { id: containerId }, include: { host: true } });
        if (!container) throw new Error('Container not found.');
        
        this.operationLogService.log('info', `[${container.host.name}] Starting update check for container ${container.name}...`);
        const updatedCount = await this.diun.checkUpdatesForHost(container.hostId);
        this.operationLogService.log('info', `[${container.host.name}] Check finished. Found ${updatedCount} updates for ${container.name}.`);
        
      } catch (error) {
        isFailed = true;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to check single container update: ${errorMessage}`);
        this.operationLogService.log('error', errorMessage);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
      return { taskId: opLog.id };
    });
  }

  async checkUpdatesAny(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Check for Updates` });
    return this.contextService.run(opLog.id, async () => {
      const hosts = await this.prisma.host.findMany({
        where: bodyHost.id === 'all' ? {} : { id: bodyHost.id },
      });
      
      this.operationLogService.log('system', `Checking updates for ${hosts.length} hosts.`);
      
      let totalUpdated = 0;
      for (const host of hosts) {
        const { updated } = await this.checkUpdates({ ...host, port: host.port ?? undefined });
        totalUpdated += updated;
      }
      
      this.operationLogService.log('system', `Update check finished. Total updates found: ${totalUpdated}.`);
      await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
      return { taskId: opLog.id };
    });
  }

  async updateOne(hostOrRef: { id: string }, containerId: string, imageRef?: string) {
    const opLog = await this.operationLogService.create({
      title: `Update Container ${containerId.substring(0, 12)}`,
    });
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        if (container.isComposeManaged) {
          await this._updateComposeService(container as any, imageRef);
        } else {
          await this._updateCliContainer(container, imageRef);
        }
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

  private async _updateComposeService(
    container: {
      composeProject?: string | null;
      composeService?: string | null;
      composeWorkingDir?: string | null;
      hostId: string;
    },
    _imageRef?: string, // Not used, but kept for signature consistency
  ) {
    const { composeProject, composeService, hostId, composeWorkingDir } = container;
    if (!composeProject || !composeService) {
      throw new Error('Compose project/service name is missing for this container.');
    }
    if (!composeWorkingDir) {
      throw new Error('Compose working directory is missing for this container.');
    }

    // Pull the new image for the specific service
    await this.composeOperate(hostId, composeProject, composeWorkingDir, 'pull', [composeService]);

    this.operationLogService.log('info', `Recreating service "${composeService}" with "docker compose up"...`);

    // Recreate the service, without touching dependencies
    await this.composeOperate(hostId, composeProject, composeWorkingDir, 'up', ['--no-deps', composeService]);

    this.operationLogService.log('info', `Compose service "${composeService}" updated successfully.`);
    this.operationLogService.log('info', `Refreshing status for project "${composeProject}"...`);
    await this.refreshStatus(hostId, { composeProject });
  }

  private async _updateCliContainer(
    container: {
      id: string;
      name: string;
      containerId: string;
      hostId: string;
      runCommand?: string | null;
      imageName?: string | null;
      imageTag?: string | null;
    },
    imageRef?: string,
  ) {
    const hostCred = await this.getHostCredById(container.hostId);
    if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

    const finalImageRef = imageRef || `${container.imageName}:${container.imageTag}`;
    this.operationLogService.log('info', `Pulling new image "${finalImageRef}"...`);
    const pullRes = await this.docker.exec(hostCred, ['pull', finalImageRef], 300);
    if (pullRes.code !== 0) throw new Error(`Image pull failed: ${pullRes.stderr}`);
    this.operationLogService.log('info', `Image pulled successfully.`);

    const backupName = `${container.name}_bk_${Date.now()}`;
    this.operationLogService.log('info', `Stopping and renaming current container to "${backupName}"...`);
    await this.docker.exec(hostCred, ['stop', container.containerId], 120);
    const renameRes = await this.docker.exec(hostCred, ['rename', container.containerId, backupName], 30);
    if (renameRes.code !== 0) {
      await this.docker.exec(hostCred, ['start', container.containerId]); // try to recover
      throw new Error(`Failed to rename container: ${renameRes.stderr}`);
    }
    this.operationLogService.log('info', `Container renamed to backup.`);

    this.operationLogService.log('info', `Creating new container with updated image...`);
    const runCommand = container.runCommand?.replace(/(\b--name\s+)(\S+)/, `$1${container.name}`);
    if (!runCommand) {
      throw new Error('Cannot update container: run command is not available.');
    }

    const { code: runCode, stdout: newContainerId, stderr: runStderr } = await this.docker.execShell(
      hostCred,
      runCommand,
    );

    if (runCode !== 0) {
      this.operationLogService.log('error', `Failed to create new container. Attempting to roll back...`);
      await this.docker.exec(hostCred, ['rename', backupName, container.name], 30);
      await this.docker.exec(hostCred, ['start', container.name], 30);
      throw new Error(`Failed to create new container: ${runStderr}`);
    }

    const newContainerIdStr = String(newContainerId).trim();
    const newContainerShortId = newContainerIdStr.substring(0, 12);
    this.operationLogService.log('info', `New container created with ID: ${newContainerShortId}.`);
    this.operationLogService.log('info', `Performing health check...`);
    await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5s for container to stabilize

    const { stdout: status } = await this.docker.exec(hostCred, [
      'inspect',
      '--format',
      '{{.State.Status}}',
      newContainerIdStr,
    ]);

    const statusStr = String(status).trim();
    if (statusStr !== 'running') {
      this.operationLogService.log('error', `Health check failed (status: ${statusStr}). Rolling back...`);
      await this.docker.exec(hostCred, ['rm', '-f', newContainerIdStr]);
      await this.docker.exec(hostCred, ['rename', backupName, container.name]);
      await this.docker.exec(hostCred, ['start', container.name]);
      throw new Error('Health check failed for the new container.');
    }

    this.operationLogService.log('info', `Health check passed. Removing backup container...`);
    await this.docker.exec(hostCred, ['rm', '-f', backupName]);
    this.operationLogService.log('info', `Update successful. Refreshing status...`);
    await this.refreshStatus(container.hostId, { containerIds: [newContainerIdStr] });
  }

  async restartOne(_hostOrRef: { id: string }, containerId: string) {
    const opLog = await this.operationLogService.create({ title: `Restart Container ${containerId.substring(0, 12)}` });
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        if (container.isComposeManaged) {
          await this.composeOperate(
            container.hostId,
            container.composeProject!,
            container.composeWorkingDir!,
            'restart',
          );
          this.operationLogService.log('info', `Compose project "${container.composeProject}" restarted. Refreshing status...`);
          await this.refreshStatus(container.hostId, { composeProject: container.composeProject! });
        } else {
          const hostCred = await this.getHostCredById(container.hostId);
          if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);
          this.operationLogService.log('info', `Attempting to restart container "${container.name}"...`);
          const { code, stderr } = await this.docker.exec(hostCred, ['restart', container.containerId], 120);
          if (code !== 0) {
            throw new Error(`Failed to restart container: ${stderr}`);
          }
          this.operationLogService.log('info', `Container "${container.name}" restarted successfully. Refreshing status...`);
          await this.refreshStatus(container.hostId, { containerIds: [container.containerId] });
        }
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

  async startOne(_hostOrRef: { id: string }, containerId: string) {
    const opLog = await this.operationLogService.create({ title: `Start Container ${containerId.substring(0, 12)}` });
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        if (container.isComposeManaged) {
          await this.composeOperate(
            container.hostId,
            container.composeProject!,
            container.composeWorkingDir!,
            'start',
          );
          this.operationLogService.log('info', `Compose project "${container.composeProject}" started. Refreshing status...`);
          await this.refreshStatus(container.hostId, { composeProject: container.composeProject! });
        } else {
          const hostCred = await this.getHostCredById(container.hostId);
          if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);
          this.operationLogService.log('info', `Attempting to start container "${container.name}"...`);
          const { code, stderr } = await this.docker.exec(hostCred, ['start', container.containerId], 120);
          if (code !== 0) {
            throw new Error(`Failed to start container: ${stderr}`);
          }
          this.operationLogService.log('info', `Container "${container.name}" started successfully. Refreshing status...`);
          await this.refreshStatus(container.hostId, { containerIds: [container.containerId] });
        }
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

  async stopOne(_hostOrRef: { id: string }, containerId: string) {
    const opLog = await this.operationLogService.create({ title: `Stop Container ${containerId.substring(0, 12)}` });
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const container = await this.prisma.container.findUnique({
          where: { id: containerId },
          include: { host: true },
        });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        if (container.isComposeManaged) {
          await this.composeOperate(
            container.hostId,
            container.composeProject!,
            container.composeWorkingDir!,
            'stop',
          );
          this.operationLogService.log('info', `Compose project "${container.composeProject}" stopped. Refreshing status...`);
          await this.refreshStatus(container.hostId, { composeProject: container.composeProject! });
        } else {
          const hostCred = await this.getHostCredById(container.hostId);
          if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);
          this.operationLogService.log('info', `Attempting to stop container "${container.name}"...`);
          const { code, stderr } = await this.docker.exec(hostCred, ['stop', container.containerId], 120);
          if (code !== 0) {
            throw new Error(`Failed to stop container: ${stderr}`);
          }
          this.operationLogService.log('info', `Container "${container.name}" stopped successfully. Refreshing status...`);
          await this.refreshStatus(container.hostId, { containerIds: [container.containerId] });
        }
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

  async composeOperate(
    hostId: string,
    project: string,
    workingDir: string,
    op: 'down' | 'pull' | 'up' | 'restart' | 'start' | 'stop',
    additionalArgs: string[] = [],
  ) {
    const existingOpId = this.contextService.getOpId();
    const opId = existingOpId || (await this.operationLogService.create({ title: `Compose Op: ${op} on ${project}` })).id;
    const isNewOperation = !existingOpId;

    return this.contextService.run(opId, async () => {
      let isFailed = false;
      try {
        const hostCred = await this.getHostCredById(hostId);
        if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

        if (!workingDir) {
          throw new Error(`Working directory is not defined for compose project "${project}"`);
        }

        this.operationLogService.log('info', `Running docker compose ${op} for project "${project}"...`);

        const args = ['compose', '--project-directory', workingDir, '-p', project, op];
        if (op === 'up') {
          args.push('-d');
        }
        args.push(...additionalArgs);

        const { code, stderr } = await this.docker.execStreaming(hostCred, args, 600);

        if (code === 0) {
          this.operationLogService.log('info', `Compose operation "${op}" successful.`);

          // Only refresh status if this is a new operation (not called from other methods)
          if (isNewOperation) {
            if (op === 'down' || op === 'up') {
              // For 'down' and 'up' operations, trigger full container discovery
              // 'down': handles removed containers
              // 'up': handles newly created containers
              this.operationLogService.log('info', `Triggering container discovery after compose ${op} for project "${project}"...`);
              await this.discoverOnHost({
                id: hostId,
                address: hostCred.address,
                sshUser: hostCred.sshUser,
                port: hostCred.port
              });
            } else {
              // For other operations (start, stop, restart, pull), just refresh status
              this.operationLogService.log('info', `Refreshing status for project "${project}"...`);
              await this.refreshStatus(hostId, { composeProject: project });
            }
          }
        } else {
          const errorMsg = `Compose operation failed. Exit code: ${code}, Error: ${stderr}`;
          this.operationLogService.log('error', errorMsg);
          throw new Error(errorMsg);
        }
        return { ok: true, code };
      } catch (err) {
        isFailed = true;
        throw err;
      } finally {
        // Only update status if we created the operation log
        if (isNewOperation) {
          await this.operationLogService.updateStatus(opId, isFailed ? 'ERROR' : 'COMPLETED');
        }
      }
    });
  }

  async refreshStatus(
    hostId: string,
    options: { containerIds?: string[]; containerNames?: string[]; composeProject?: string },
  ): Promise<{ taskId: string }> {
    const opId =
      this.contextService.getOpId() ||
      (await this.operationLogService.create({ title: `Refresh status on host ${hostId}` })).id;
    this.contextService.run(opId, async () => {
      let isFailed = false;
      try {
        const hostCred = await this.getHostCredById(hostId);
        if (!hostCred) throw new Error(`Host not found: ${hostId}`);

        let targetContainerIds: string[] = options.containerIds || [];
        if (options.containerNames?.length) {
          const containers = await this.prisma.container.findMany({
            where: { hostId, name: { in: options.containerNames } },
            select: { containerId: true },
          });
          targetContainerIds.push(...containers.map(c => c.containerId));
        }
        if (options.composeProject) {
          const containers = await this.prisma.container.findMany({
            where: { hostId, composeProject: options.composeProject },
            select: { containerId: true },
          });
          targetContainerIds.push(...containers.map(c => c.containerId));
        }
        targetContainerIds = [...new Set(targetContainerIds)];

        if (!targetContainerIds.length) {
          this.operationLogService.log('info', 'No target containers specified for status refresh.');
          return;
        }

        // 1. Get fresh user-friendly status from `docker ps`
        const { code, stdout, stderr } = await this.docker.exec(hostCred, ['ps', '-a', '--format', '{{json .}}', '--filter', `id=${targetContainerIds.join(',')}`]);
        if (code !== 0) {
          throw new Error(`'docker ps' for status refresh failed: ${stderr}`);
        }
        const psStatusMap = new Map<string, string>();
        const psOutputLines = stdout.split('\n').filter(Boolean);
        for (const line of psOutputLines) {
          try {
            const containerInfo = JSON.parse(line);
            psStatusMap.set(containerInfo.ID, containerInfo.Status);
          } catch (e) {
            this.operationLogService.log('info', `Could not parse docker ps JSON line during refresh: ${line}`);
          }
        }

        // 2. Get detailed raw status from `docker inspect`
        this.operationLogService.log('info', `Inspecting ${targetContainerIds.length} containers...`);
        const inspects = await this.docker.inspectContainers(hostCred, targetContainerIds);

        // 3. Update database
        const updates = inspects.map(det => {
          return this.prisma.container.update({
            where: { hostId_containerId: { hostId, containerId: det.Id } },
            data: {
              state: det.State.Status,
              status: psStatusMap.get(det.Id) || det.State.Status, // Use fresh ps status
              restartCount: det.RestartCount,
              startedAt: new Date(det.State.StartedAt),
            },
          });
        });
        await this.prisma.$transaction(updates);
        this.operationLogService.log('info', `Updated status for ${updates.length} containers.`);
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Status refresh failed: ${errorMessage}`);
      } finally {
        if (!this.contextService.getOpId()) {
          // Only update status if we created the log
          await this.operationLogService.updateStatus(opId, isFailed ? 'ERROR' : 'COMPLETED');
        }
      }
    });
    return { taskId: opId };
  }

  async refreshRunningStatusAllHosts(): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: 'Refresh All Host Statuses' });
    this.contextService.run(opLog.id, async () => {
      const hosts = await this.prisma.host.findMany({ select: { id: true } });
      this.operationLogService.log('info', `Refreshing status for ${hosts.length} hosts.`);
      for (const host of hosts) {
        const runningContainers = await this.prisma.container.findMany({
          where: { hostId: host.id, state: 'running' },
          select: { containerId: true },
        });
        if (runningContainers.length > 0) {
          await this.refreshStatus(host.id, { containerIds: runningContainers.map(c => c.containerId) });
        }
      }
      this.operationLogService.log('info', 'All hosts refreshed.');
      await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
    });
    return { taskId: opLog.id };
  }

  async cleanupDuplicates(hostId?: string | 'all'): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Cleanup Duplicate Containers` });
    this.contextService.run(opLog.id, async () => {
      const where = hostId === 'all' ? {} : { id: hostId };
      const hosts = await this.prisma.host.findMany({ where, select: { id: true, address: true } });
      this.operationLogService.log('info', `Checking ${hosts.length} hosts for duplicates.`);
      let totalDeleted = 0;

      for (const host of hosts) {
        const allHostContainers = await this.prisma.container.findMany({ where: { hostId: host.id } });
        const logicalKeyToContainers = new Map<string, any[]>();

        for (const c of allHostContainers) {
          const logicalKey = c.isComposeManaged ? `compose_${c.composeProject}_${c.composeService}` : `cli_${c.name}`;
          if (!logicalKeyToContainers.has(logicalKey)) {
            logicalKeyToContainers.set(logicalKey, []);
          }
          logicalKeyToContainers.get(logicalKey)!.push(c);
        }

        const idsToDelete: string[] = [];
        for (const containers of logicalKeyToContainers.values()) {
          if (containers.length > 1) {
            const sorted = containers.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
            const latest = sorted[0];
            const duplicates = sorted.slice(1);
            this.operationLogService.log(
              'info',
              `[${host.address}] Found ${duplicates.length} duplicates for ${latest.name}. Keeping latest.`,
            );
            idsToDelete.push(...duplicates.map(d => d.id));
          }
        }

        if (idsToDelete.length > 0) {
          const { count } = await this.prisma.container.deleteMany({ where: { id: { in: idsToDelete } } });
          totalDeleted += count;
        }
      }
      this.operationLogService.log('info', `Cleanup complete. Deleted ${totalDeleted} duplicate entries.`);
      await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
    });
    return { taskId: opLog.id };
  }

  async purgeContainers(hostId?: string | 'all'): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Purge Exited Containers` });
    this.contextService.run(opLog.id, async () => {
      const where: Prisma.ContainerWhereInput = { state: 'exited' };
      if (hostId && hostId !== 'all') {
        where.hostId = hostId;
      }
      this.operationLogService.log('info', `Purging exited containers...`);
      const { count } = await this.prisma.container.deleteMany({ where });
      this.operationLogService.log('info', `Purged ${count} exited containers from the database.`);
      await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
    });
    return { taskId: opLog.id };
  }

  async checkComposeProjectUpdates(hostId: string, composeProject: string): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({
      title: `Check Compose Project Updates for ${composeProject}`,
    });
    this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const hostCred = await this.getHostCredById(hostId);
        if (!hostCred) throw new Error(`Host not found: ${hostId}`);

        const containers = await this.prisma.container.findMany({
          where: { hostId, composeProject },
        });
        if (!containers.length) {
          throw new Error(`No containers found for compose project "${composeProject}" on this host.`);
        }

        this.operationLogService.log(
          'info',
          `Checking for updates for ${containers.length} services in project "${composeProject}"...`,
        );
        let updatedCount = 0;

        for (const container of containers) {
          const imageRef = `${container.imageName}:${container.imageTag}`;
          this.operationLogService.log('info', `Checking service ${container.composeService} (${imageRef})...`);

          const platform = await this.docker.getContainerPlatform(hostCred, container.containerId);
          const { updateAvailable, remoteDigest, error } = await this.docker.checkImageUpdate(
            hostCred,
            imageRef,
            container.repoDigest,
            platform,
          );

          if (error) {
            this.operationLogService.log('info', `Could not check for updates for ${imageRef}: ${error}`);
            continue;
          }

          await this.prisma.container.update({
            where: { id: container.id },
            data: {
              updateAvailable,
              remoteDigest,
              updateCheckedAt: new Date(),
            },
          });

          if (updateAvailable) {
            updatedCount++;
            this.operationLogService.log('info', `Update available for ${imageRef}!`);
          }
        }
        this.operationLogService.log(
          'info',
          `Check complete. Found ${updatedCount} available updates for project "${composeProject}".`,
        );
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Compose project update check failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });
    return { taskId: opLog.id };
  }

  private async getHostCredById(hostId: string): Promise<{ id: string; address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string } | null> {
    const h = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!h) return null;
    const decPassword = this.crypto.decryptString(h.sshPassword)?.toString();
    const decKey = this.crypto.decryptString(h.sshPrivateKey)?.toString();
    const decPassphrase = this.crypto.decryptString(h.sshPrivateKeyPassphrase)?.toString();
    return { id: h.id, address: h.address, sshUser: h.sshUser, port: h.port ?? undefined, password: decPassword, privateKey: decKey, privateKeyPassphrase: decPassphrase };
  }

  private async generateRunCommand(_inspectData: any, _containerName: string): Promise<string | undefined> {
    // This is a complex method that would need careful refactoring if it were to log.
    // For now, we assume it doesn't produce logs itself.
    return "";
  }
}