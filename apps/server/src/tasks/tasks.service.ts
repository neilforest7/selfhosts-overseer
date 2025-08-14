import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HostsService } from '../hosts/hosts.service';
import { SettingsService } from '../settings/settings.service';
import { SshService } from '../ssh/ssh.service';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';

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
    private readonly crypto: CryptoService
  ) {}

  async exec(req: ExecRequest): Promise<TaskRun> {
    // 使用前端提供的opId或生成新的ID
    const taskId = req.opId || `task_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    const created = await this.prisma.taskRun.create({
      data: {
        id: taskId,
        status: 'running',
        command: req.command,
        targets: req.targets,
        startedAt: new Date()
      }
    });

    // fire-and-forget execution
    void this.runTask(created.id).catch(() => void 0);

    return {
      id: created.id,
      status: 'running',
      request: { command: req.command, targets: req.targets, opId: req.opId },
      startedAt: created.startedAt?.toISOString()
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
      finishedAt: r.finishedAt?.toISOString()
    };
  }

  private async runTask(taskId: string): Promise<void> {
    const task = await this.prisma.taskRun.findUnique({ where: { id: taskId } });
    if (!task) return;
    const settings = await this.settingsService.get();
    const { items: allHosts } = await this.hostsService.list(undefined, 1000);
    const targets = task.targets
      .map(tid => allHosts.find(h => h.id === tid))
      .filter(Boolean) as any[];

    const timeoutSec = settings.commandTimeoutSeconds;
    let anyFailed = false;

    // system hints: task start summary (write then broadcast structured event)
    const startSummary = `>>> 任务开始: 命令 "${task.command}" · 目标 ${targets.length} 台 · 并发 ${settings.sshConcurrency} · 超时 ${timeoutSec}s`;
    const startLog = await this.prisma.taskLog.create({
      data: { taskId, stream: 'stdout', hostLabel: 'system', content: startSummary }
    });
    // 先同步推送 start，再进入具体主机执行，尽量保证它是流中的第一条
    this.gateway.emitLog(taskId, {
      eventId: startLog.id,
      taskId,
      type: 'task-start',
      stream: 'system',
      ts: new Date((startLog as any).ts ?? Date.now()).getTime(),
      hostLabel: 'system',
      content: startSummary
    });
    if (targets.length === 0) {
      const msg = '未选择任何目标主机';
      const warnLog = await this.prisma.taskLog.create({ data: { taskId, stream: 'stderr', hostLabel: 'system', content: msg } });
      this.gateway.emitLog(taskId, {
        eventId: warnLog.id,
        taskId,
        type: 'log',
        stream: 'system',
        ts: new Date((warnLog as any).ts ?? Date.now()).getTime(),
        hostLabel: 'system',
        content: msg
      });
    }

    const runOne = async (target: any) => {
      const prefix = `[${target.name}@${target.address}] `;
      // per-host start hint (write then emit)
      const hostStart = await this.prisma.taskLog.create({
        data: { taskId, stream: 'stdout', hostLabel: `${target.name}@${target.address}`, content: '>>> 开始' }
      });
      this.gateway.emitLog(taskId, {
        eventId: hostStart.id,
        taskId,
        type: 'host-start',
        stream: 'stdout',
        ts: new Date((hostStart as any).ts ?? Date.now()).getTime(),
        hostId: target.id,
        hostLabel: `${target.name}@${target.address}`,
        content: '>>> 开始'
      });
      
      // 获取主机详细信息以进行SSH认证
      const hostDetail = await this.prisma.host.findUnique({ where: { id: target.id } });
      if (!hostDetail) {
        this.gateway.broadcast(taskId, 'stderr', `${prefix}主机信息未找到`);
        anyFailed = true;
        return;
      }
      
      // 解密SSH认证信息
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
        onStdout: async (d) => {
          const log = await this.prisma.taskLog.create({
            data: { taskId, stream: 'stdout', hostLabel: `${target.name}@${target.address}` , content: d }
          });
          this.gateway.emitLog(taskId, {
            eventId: log.id,
            taskId,
            type: 'log',
            stream: 'stdout',
            ts: new Date((log as any).ts ?? Date.now()).getTime(),
            hostId: target.id,
            hostLabel: `${target.name}@${target.address}`,
            content: d
          });
        },
        onStderr: async (d) => {
          const log = await this.prisma.taskLog.create({
            data: { taskId, stream: 'stderr', hostLabel: `${target.name}@${target.address}`, content: d }
          });
          this.gateway.emitLog(taskId, {
            eventId: log.id,
            taskId,
            type: 'log',
            stream: 'stderr',
            ts: new Date((log as any).ts ?? Date.now()).getTime(),
            hostId: target.id,
            hostLabel: `${target.name}@${target.address}`,
            content: d
          });
        }
      });
      if (code !== 0) anyFailed = true;
      // per-host end hint (write then emit)
      const hostEnd = await this.prisma.taskLog.create({
        data: { taskId, stream: 'stdout', hostLabel: `${target.name}@${target.address}`, content: `<<< 结束 (code ${code})` }
      });
      this.gateway.emitLog(taskId, {
        eventId: hostEnd.id,
        taskId,
        type: 'host-end',
        stream: 'stdout',
        ts: new Date((hostEnd as any).ts ?? Date.now()).getTime(),
        hostId: target.id,
        hostLabel: `${target.name}@${target.address}`,
        content: `<<< 结束 (code ${code})`
      });
    };

    const concurrency = settings.sshConcurrency;
    const queue = targets.slice();
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.max(1, concurrency); i++) {
      workers.push((async () => {
        while (queue.length) {
          const next = queue.shift();
          if (!next) break;
          await runOne(next);
        }
      })());
    }
    await Promise.all(workers);

    await this.prisma.taskRun.update({
      where: { id: taskId },
      data: { status: anyFailed ? 'failed' : 'succeeded', finishedAt: new Date() }
    });
    const endSummary = `<<< 任务结束 · 状态 ${anyFailed ? 'failed' : 'succeeded'}`;
    const endLog = await this.prisma.taskLog.create({ data: { taskId, stream: 'stdout', hostLabel: 'system', content: endSummary } });
    this.gateway.emitLog(taskId, {
      eventId: endLog.id,
      taskId,
      type: 'task-end',
      stream: 'system',
      ts: new Date((endLog as any).ts ?? Date.now()).getTime(),
      hostLabel: 'system',
      content: endSummary
    });
    this.gateway.broadcast(taskId, 'end', { status: anyFailed ? 'failed' : 'succeeded' });
  }
}

