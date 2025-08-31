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
    let isFailed = false;
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
          this.operationLogService.log('warn', `Could not parse docker ps JSON line: ${line}`, host.id);
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
      isFailed = true;
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
    const opLog = await this.operationLogService.create({ title: `Update Container ${containerId}` });
    return this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        const hostCred = await this.getHostCredById(hostOrRef.id);
        if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);
        const container = await this.prisma.container.findUnique({ where: { id: containerId } });
        if (!container) throw new Error(`Container with id ${containerId} not found`);

        const finalImageRef = imageRef || container.imageName!;
        this.operationLogService.log('info', `Pulling new image "${finalImageRef}"...`, hostCred.id);
        const pullRes = await this.docker.exec(hostCred, ['pull', finalImageRef], 300);
        if (pullRes.code !== 0) throw new Error(`Image pull failed: ${pullRes.stderr}`);

        this.operationLogService.log('info', `Container "${container.name}" will be updated. This is a placeholder for the full update logic.`, hostCred.id);
        // TODO: Implement the full update logic: stop, rename, run new, health check, cleanup/rollback
        
      } catch (err) {
        isFailed = true;
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.operationLogService.log('error', `Update failed: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
      return { ok: !isFailed };
    });
  }

  async restartOne(hostOrRef: { id: string }, containerId: string) {
    const opLog = await this.operationLogService.create({ title: `Restart Container ${containerId}` });
    return this.contextService.run(opLog.id, async () => {
      const hostCred = await this.getHostCredById(hostOrRef.id);
      if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);

      const container = await this.prisma.container.findUnique({ where: { id: containerId } });
      if (!container) throw new Error(`Container with id ${containerId} not found`);

      this.operationLogService.log('info', `Attempting to restart container "${container.name}" on host "${hostCred.address}"...`, hostCred.id);

      const { code, stderr } = await this.docker.exec(
        hostCred,
        ['restart', container.containerId],
        120,
      );

      if (code === 0) {
        this.operationLogService.log('info', `Container "${container.name}" restarted successfully.`, hostCred.id);
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
      } else {
        const errorMsg = `Failed to restart container "${container.name}". Exit code: ${code}, Error: ${stderr}`;
        this.operationLogService.log('error', errorMsg, hostCred.id);
        await this.operationLogService.updateStatus(opLog.id, 'ERROR');
        throw new Error(errorMsg);
      }

      return { ok: true };
    });
  }

  async startOne(hostOrRef: { id: string }, containerId: string) {
    const opLog = await this.operationLogService.create({ title: `Start Container ${containerId}` });
    return this.contextService.run(opLog.id, async () => {
      const hostCred = await this.getHostCredById(hostOrRef.id);
      if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);
      const container = await this.prisma.container.findUnique({ where: { id: containerId } });
      if (!container) throw new Error(`Container with id ${containerId} not found`);

      this.operationLogService.log('info', `Attempting to start container "${container.name}"...`, hostCred.id);
      const { code, stderr } = await this.docker.exec(hostCred, ['start', container.containerId], 120);

      if (code === 0) {
        this.operationLogService.log('info', `Container "${container.name}" started successfully.`, hostCred.id);
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
      } else {
        const errorMsg = `Failed to start container "${container.name}". Exit code: ${code}, Error: ${stderr}`;
        this.operationLogService.log('error', errorMsg, hostCred.id);
        await this.operationLogService.updateStatus(opLog.id, 'ERROR');
        throw new Error(errorMsg);
      }
      return { ok: true };
    });
  }
  
  async stopOne(hostOrRef: { id: string }, containerId: string) {
    const opLog = await this.operationLogService.create({ title: `Stop Container ${containerId}` });
    return this.contextService.run(opLog.id, async () => {
      const hostCred = await this.getHostCredById(hostOrRef.id);
      if (!hostCred) throw new Error(`Host with id ${hostOrRef.id} not found`);
      const container = await this.prisma.container.findUnique({ where: { id: containerId } });
      if (!container) throw new Error(`Container with id ${containerId} not found`);

      this.operationLogService.log('info', `Attempting to stop container "${container.name}"...`, hostCred.id);
      const { code, stderr } = await this.docker.exec(hostCred, ['stop', container.containerId], 120);

      if (code === 0) {
        this.operationLogService.log('info', `Container "${container.name}" stopped successfully.`, hostCred.id);
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
      } else {
        const errorMsg = `Failed to stop container "${container.name}". Exit code: ${code}, Error: ${stderr}`;
        this.operationLogService.log('error', errorMsg, hostCred.id);
        await this.operationLogService.updateStatus(opLog.id, 'ERROR');
        throw new Error(errorMsg);
      }
      return { ok: true };
    });
  }

  async composeOperate(hostId: string, project: string, workingDir: string, op: 'down'|'pull'|'up'|'restart'|'start'|'stop') {
    const opLog = await this.operationLogService.create({ title: `Compose Op: ${op} on ${project}` });
    return this.contextService.run(opLog.id, async () => {
      const hostCred = await this.getHostCredById(hostId);
      if (!hostCred) throw new Error(`Host with id ${hostId} not found`);

      this.operationLogService.log('info', `Running docker compose ${op} for project "${project}"...`, hostId);
      const { code, stderr } = await this.docker.exec(hostCred, ['compose', '-p', project, '-f', `${workingDir}/docker-compose.yml`, op, '-d'], 300);

      if (code === 0) {
        this.operationLogService.log('info', `Compose operation "${op}" successful.`, hostId);
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
      } else {
        const errorMsg = `Compose operation failed. Exit code: ${code}, Error: ${stderr}`;
        this.operationLogService.log('error', errorMsg, hostId);
        await this.operationLogService.updateStatus(opLog.id, 'ERROR');
        throw new Error(errorMsg);
      }
      return { ok: true, code };
    });
  }

  async refreshStatus(hostId: string, options: { containerIds?: string[]; containerNames?: string[]; composeProject?: string }): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Refresh status on host ${hostId}` });
    return this.contextService.run(opLog.id, async () => {
        this.operationLogService.log('system', 'Refreshing container status... This is a placeholder.');
        // TODO: Implement the logic to inspect specific containers and update their status in the DB.
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
        return { taskId: opLog.id };
    });
  }

  async cleanupDuplicates(hostId?: string | 'all'): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Cleanup Duplicate Containers` });
    return this.contextService.run(opLog.id, async () => {
        this.operationLogService.log('system', 'Cleaning up duplicate containers... This is a placeholder.');
        // TODO: Implement the logic to find and remove duplicate container entries from the DB.
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
        return { taskId: opLog.id };
    });
  }

  async purgeContainers(hostId?: string | 'all'): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Purge Containers` });
    return this.contextService.run(opLog.id, async () => {
        this.operationLogService.log('system', 'Purging containers... This is a placeholder.');
        // TODO: Implement the logic to remove exited containers from the DB.
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
        return { taskId: opLog.id };
    });
  }

  async checkComposeProjectUpdates(hostId: string, composeProject: string): Promise<{ taskId: string }> {
    const opLog = await this.operationLogService.create({ title: `Check Compose Project Updates for ${composeProject}` });
    return this.contextService.run(opLog.id, async () => {
        this.operationLogService.log('system', `Checking for compose project updates... This is a placeholder.`);
        // TODO: Implement the logic to check for updates for all images in a compose project.
        await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
        return { taskId: opLog.id };
    });
  }

  private async getHostCredById(hostId: string): Promise<{ id: string; address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string } | null> {
    const h = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!h) return null;
    const decPassword = this.crypto.decryptString(h.sshPassword)?.toString();
    const decKey = this.crypto.decryptString(h.sshPrivateKey)?.toString();
    const decPassphrase = this.crypto.decryptString(h.sshPrivateKeyPassphrase)?.toString();
    return { id: h.id, address: h.address, sshUser: h.sshUser, port: h.port ?? undefined, password: decPassword, privateKey: decKey, privateKeyPassphrase: decPassphrase };
  }

  private async generateRunCommand(inspectData: any, containerName: string): Promise<string | undefined> {
    // This is a complex method that would need careful refactoring if it were to log.
    // For now, we assume it doesn't produce logs itself.
    return "";
  }
}