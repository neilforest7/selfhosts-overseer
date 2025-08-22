import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HostsService } from '../hosts/hosts.service';
import { SettingsService } from '../settings/settings.service';
import { SshService } from '../ssh/ssh.service';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContainersService } from '../containers/containers.service';

export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface ExecRequest {
  targets: string[]; // host ids (later)
  command: string;
  opId?: string; // optional frontend-provided operation ID
}

export interface TaskRun {
  id: string;
  status: TaskStatus;
  request: ExecRequest;
  startedAt?: string;
  finishedAt?: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hostsService: HostsService,
    private readonly settingsService: SettingsService,
    private readonly sshService: SshService,
    private readonly gateway: ExecGateway,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
    @Inject(forwardRef(() => ContainersService))
    private readonly containersService: ContainersService,
  ) {}

  async exec(req: ExecRequest): Promise<TaskRun> {
    const taskId = req.opId;
    if (!taskId) {
      throw new Error('Operation ID (opId) is required to execute a task.');
    }

    console.log(`🎯 关联任务: ${req.command} (目标: ${req.targets.length} 台, ID: ${taskId})`);

    const created = await this.prisma.taskRun.create({
      data: {
        id: taskId,
        status: 'running',
        command: req.command,
        targets: req.targets,
        startedAt: new Date(),
      },
    });

    // fire-and-forget execution
    void this.runTask(created.id).catch((err) => {
      console.error(`Task ${taskId} failed unexpectedly:`, err);
      // Ensure the operation is marked as failed on unexpected error
      this.operationLogService.updateStatus(taskId, 'ERROR', `An unexpected error occurred: ${err.message}`);
    });

    return {
      id: created.id,
      status: 'running',
      request: { command: req.command, targets: req.targets, opId: taskId },
      startedAt: created.startedAt?.toISOString(),
    };
  }

  async get(id: string): Promise<TaskRun | undefined> {
    const r = await this.prisma.taskRun.findUnique({ where: { id } });
    if (!r) return undefined;
    return {
      id: r.id,
      status: r.status as TaskStatus,
      request: { command: r.command, targets: r.targets },
      startedAt: r.startedAt?.toISOString(),
      finishedAt: r.finishedAt?.toISOString(),
    };
  }

  private async runTask(taskId: string): Promise<void> {
    console.log(`[TasksService] runTask started for taskId: ${taskId}`);
    const task = await this.prisma.taskRun.findUnique({ where: { id: taskId } });
    if (!task) {
      console.error(`[TasksService] Task with id ${taskId} not found in database. Aborting runTask.`);
      return;
    }
    const settings = await this.settingsService.get();
    const { items: allHosts } = await this.hostsService.list(undefined, 1000);
    const targets = task.targets.map((tid) => allHosts.find((h) => h.id === tid)).filter(Boolean) as any[];
    console.log(`[TasksService] taskId: ${taskId} - Found ${targets.length} target hosts.`);

    const timeoutSec = settings.commandTimeoutSeconds;
    let anyFailed = false;
    const logsBuffer: string[] = [];

    const startSummary = `>>> 任务开始: 命令 "${task.command}" · 目标 ${targets.length} 台 · 并发 ${settings.sshConcurrency} · 超时 ${timeoutSec}s\n`;
    logsBuffer.push(startSummary);
    this.gateway.broadcast(taskId, 'data', startSummary);

    if (targets.length === 0) {
      const msg = '未选择任何目标主机\n';
      logsBuffer.push(msg);
      this.gateway.broadcast(taskId, 'stderr', msg);
    }

    const runOne = async (target: any) => {
      if (task.command === 'internal:discover_containers') {
        try {
          await this.containersService.discoverOnHost(target, taskId, (log) => {
            logsBuffer.push(log);
          });
        } catch (err) {
          anyFailed = true;
          const errorMsg = `[${target.name}] Discovery failed: ${err.message}\n`;
          console.error(`[TasksService] internal:discover_containers failed for taskId: ${taskId} on host ${target.name}`, err);
          logsBuffer.push(errorMsg);
          this.gateway.broadcast(taskId, 'stderr', errorMsg);
        }
        return;
      }

      const prefix = `[${target.name}@${target.address}] `;
      console.log(`[TasksService] runOne started for taskId: ${taskId} on host ${target.name}`);
      
      const logAndBroadcast = (stream: 'data' | 'stderr', content: string) => {
        logsBuffer.push(content);
        this.gateway.broadcast(taskId, stream, content);
      };

      logAndBroadcast('data', `${prefix}>>> 开始\n`);

      const hostDetail = await this.prisma.host.findUnique({ where: { id: target.id } });
      if (!hostDetail) {
        logAndBroadcast('stderr', `${prefix}主机信息未找到\n`);
        anyFailed = true;
        console.error(`[TasksService] runOne failed for taskId: ${taskId} on host ${target.name} - Host detail not found.`);
        return;
      }

      const decPassword = this.crypto?.decryptString(hostDetail.sshPassword) ?? undefined;
      const decKey = this.crypto?.decryptString(hostDetail.sshPrivateKey) ?? undefined;
      const decPassphrase = this.crypto?.decryptString(hostDetail.sshPrivateKeyPassphrase) ?? undefined;

      const code = await this.sshService.execute({
        host: target.address,
        user: target.sshUser,
        port: target.port,
        password: decPassword,
        privateKey: decKey,
        privateKeyPassphrase: decPassphrase,
        command: task.command,
        connectTimeoutSeconds: Math.min(30, Math.max(5, Math.floor(timeoutSec / 2))),
        killAfterSeconds: timeoutSec,
        onStdout: (chunk) => {
          const lines = chunk.toString().trimEnd().split('\n').map(line => `${prefix}${line}\n`).join('');
          logAndBroadcast('data', lines);

        },
        onStderr: (chunk) => {
          const lines = chunk.toString().trimEnd().split('\n').map(line => `${prefix}${line}\n`).join('');
          logAndBroadcast('stderr', lines);
        },
      });
      if (code !== 0) anyFailed = true;
      console.log(`[TasksService] runOne finished for taskId: ${taskId} on host ${target.name} with exit code ${code}`);

      logAndBroadcast('data', `${prefix}<<< 结束 (code ${code})\n`);
    };

    const concurrency = settings.sshConcurrency;
    const queue = targets.slice();
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) {
      workers.push(
        (async () => {
          while (queue.length) {
            const next = queue.shift();
            if (!next) break;
            await runOne(next);
          }
        })(),
      );
    }
    console.log(`[TasksService] taskId: ${taskId} - Waiting for all ${workers.length} workers to finish.`);
    await Promise.all(workers);
    console.log(`[TasksService] taskId: ${taskId} - All workers finished.`);

    // Now, append all buffered logs in a single operation.
    if (logsBuffer.length > 0) {
      console.log(`[TasksService] taskId: ${taskId} - Appending ${logsBuffer.length} log entries to the database.`);
      await this.operationLogService.appendToLog(taskId, logsBuffer.join(''));
    }

    const finalStatus = anyFailed ? 'ERROR' : 'COMPLETED';
    console.log(`[TasksService] taskId: ${taskId} - Preparing to update final status to: ${finalStatus}`);
    try {
      await this.operationLogService.updateStatus(taskId, finalStatus);
      console.log(`[TasksService] taskId: ${taskId} - Successfully updated final status to: ${finalStatus}`);
    } catch (err) {
      console.error(`[TasksService] taskId: ${taskId} - FAILED to update final status. Error:`, err);
    }
    this.gateway.broadcast(taskId, 'end', { status: anyFailed ? 'failed' : 'succeeded' });
    console.log(`[TasksService] taskId: ${taskId} - Broadcasted 'end' event.`);
  }
}