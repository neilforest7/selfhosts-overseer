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

    const runOne = async (target: any) => {
      const prefix = `[${target.name}@${target.address}] `;
      
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
          this.gateway.broadcast(taskId, 'data', prefix + d);
          await this.prisma.taskLog.create({
            data: { taskId, stream: 'stdout', hostLabel: `${target.name}@${target.address}` , content: d }
          });
        },
        onStderr: async (d) => {
          this.gateway.broadcast(taskId, 'stderr', prefix + d);
          await this.prisma.taskLog.create({
            data: { taskId, stream: 'stderr', hostLabel: `${target.name}@${target.address}`, content: d }
          });
        }
      });
      if (code !== 0) anyFailed = true;
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
    this.gateway.broadcast(taskId, 'end', { status: anyFailed ? 'failed' : 'succeeded' });
  }
}

