import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HostsService } from '../hosts/hosts.service';
import { SettingsService } from '../settings/settings.service';
import { SshService } from '../ssh/ssh.service';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContainersService } from '../containers/containers.service';
import { OperationLog } from '@prisma/client';

export interface ExecRequest {
  opId: string;
  command: string;
  targets: string[];
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

  async exec(req: ExecRequest): Promise<OperationLog | null> {
    const { opId, command, targets } = req;
    console.log(`🎯 Starting task for opId: ${opId}, command: ${command}`);

    await this.operationLogService.updateStatus(opId, 'RUNNING');

    // Fire-and-forget execution
    void this.runTask(opId, command, targets).catch(async err => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Task ${opId} failed unexpectedly:`, errorMessage);
      await this.operationLogService.log(opId, 'error', `An unexpected error occurred: ${errorMessage}`);
      await this.operationLogService.updateStatus(opId, 'ERROR');
    });

    return this.prisma.operationLog.findUnique({ where: { id: opId } });
  }

  private async runTask(opId: string, command: string, targets: string[]): Promise<void> {
    await this.operationLogService.updateStatus(opId, 'RUNNING');
    const settings = await this.settingsService.get();
    const { items: allHosts } = await this.hostsService.list(undefined, 1000);
    const targetHosts = targets.map(tid => allHosts.find(h => h.id === tid)).filter(Boolean) as any[];

    let anyFailed = false;

    const log = (stream: 'system' | 'info' | 'error' | 'stdout' | 'stderr', content: string, hostId?: string) => {
      this.operationLogService.log(opId, stream, content, hostId);
    };

    log('system', `>>> Task started: command "${command}" on ${targetHosts.length} targets.`);

    const runOne = async (target: any) => {
      if (command === 'internal:discover_containers') {
        try {
          // discoverOnHost now handles its own logging internally
          await this.containersService.discoverOnHost(target, opId);
        } catch (err) {
          anyFailed = true;
          const errorMessage = err instanceof Error ? err.message : String(err);
          log('error', `[${target.name}] Discovery failed: ${errorMessage}`, target.id);
        }
        return;
      }

      const prefix = `[${target.name}@${target.address}] `;
      log('system', `${prefix}>>> Starting execution...`, target.id);

      const hostDetail = await this.prisma.host.findUnique({ where: { id: target.id } });
      if (!hostDetail) {
        anyFailed = true;
        log('error', `${prefix}Host details not found.`, target.id);
        return;
      }

      const decPassword = this.crypto.decryptString(hostDetail.sshPassword)?.toString();
      const decKey = this.crypto.decryptString(hostDetail.sshPrivateKey)?.toString();
      const decPassphrase = this.crypto.decryptString(hostDetail.sshPrivateKeyPassphrase)?.toString();

      // The new execWithStreaming will log stdout/stderr in real-time
      const { code } = await this.sshService.execWithStreaming(
        {
          host: target.address,
          user: target.sshUser,
          port: target.port ?? undefined,
          password: decPassword,
          privateKey: decKey,
          privateKeyPassphrase: decPassphrase,
          command: command,
          connectTimeoutSeconds: 30,
          killAfterSeconds: 100,
        },
        opId,
        target.id,
      );

      if (code !== 0) anyFailed = true;
      log('system', `${prefix}<<< Finished with exit code ${code}.`, target.id);
    };

    const concurrency = settings.sshConcurrency;
    const queue = targetHosts.slice();
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
    await Promise.all(workers);

    log('system', `<<< Task finished. Status: ${anyFailed ? 'failed' : 'succeeded'}`);

    await this.operationLogService.updateStatus(opId, anyFailed ? 'ERROR' : 'COMPLETED');
  }
}
