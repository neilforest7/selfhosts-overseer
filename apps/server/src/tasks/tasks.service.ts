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
import { ContextService } from '../context/context.service';
import { FrpService } from '../frp/frp.service';

export interface ExecRequest {
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
    private readonly contextService: ContextService, // Injected
    @Inject(forwardRef(() => ContainersService))
    private readonly containersService: ContainersService,
    private readonly frpService: FrpService,
  ) {}

  async exec(req: ExecRequest): Promise<OperationLog | null> {
    const { command, targets } = req;
    const opId = this.contextService.getOpId();
    if (!opId) {
      throw new Error('Cannot execute a task outside of an operation context.');
    }
    
    console.log(`🎯 Starting task for opId: ${opId}, command: ${command}`);

    await this.operationLogService.updateStatus(opId, 'RUNNING');

    // Fire-and-forget execution
    void this.runTask(command, targets).catch(async err => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`Task ${opId} failed unexpectedly:`, errorMessage);
      this.operationLogService.log('error', `An unexpected error occurred: ${errorMessage}`);
      await this.operationLogService.updateStatus(opId, 'ERROR');
    });

    return this.prisma.operationLog.findUnique({ where: { id: opId } });
  }

  private async runTask(command: string, targets: string[]): Promise<void> {
    console.log('--- RUNTASK METHOD CALLED ---');
    const opId = this.contextService.getOpId();
    if (!opId) return; // Should not happen if called from exec

    const settings = await this.settingsService.get();
    const { items: allHosts } = await this.hostsService.list(undefined, 1000);
    const targetHosts = targets.map(tid => allHosts.find(h => h.id === tid)).filter(Boolean) as any[];

    let anyFailed = false;

    this.operationLogService.log('system', `>>> Task started: command "${command}" on ${targetHosts.length} targets.`);

    const runOne = async (target: any) => {
      if (command === 'internal:discover_containers') {
        try {
          await this.containersService.discoverOnHost(target);
        } catch (err) {
          anyFailed = true;
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.operationLogService.log('error', `[${target.name}] Discovery failed: ${errorMessage}`, target.id);
        }
        return;
      }

      if (command === 'internal:refresh_container_status') {
        try {
          await this.containersService.refreshStatusOnHost(target);
        } catch (err) {
          anyFailed = true;
          const errorMessage = err instanceof Error ? err.message : String(err);
          this.operationLogService.log('error', `[${target.name}] Status refresh failed: ${errorMessage}`, target.id);
        }
        return;
      }

      const prefix = `[${target.name}@${target.address}] `;
      this.operationLogService.log('system', `${prefix}>>> Starting execution...`, target.id);

      const hostDetail = await this.prisma.host.findUnique({ where: { id: target.id } });
      if (!hostDetail) {
        anyFailed = true;
        this.operationLogService.log('error', `${prefix}Host details not found.`, target.id);
        return;
      }

      const decPassword = this.crypto.decryptString(hostDetail.sshPassword)?.toString();
      const decKey = this.crypto.decryptString(hostDetail.sshPrivateKey)?.toString();
      const decPassphrase = this.crypto.decryptString(hostDetail.sshPrivateKeyPassphrase)?.toString();

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
        target.id,
      );

      if (code !== 0) anyFailed = true;
      this.operationLogService.log('system', `${prefix}<<< Finished with exit code ${code}.`, target.id);
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

    // Phase 2: Resolve FRP dependencies after all hosts have been processed
    // Run dependency resolution even if some individual hosts failed, as long as at least one succeeded
    if (command === 'internal:discover_containers') {
      try {
        this.operationLogService.log('system', 'Starting FRP dependency resolution phase...');
        const result = await this.frpService.resolveFrpDependencies();
        this.operationLogService.log('system', `FRP dependency resolution completed. Resolved: ${result.resolvedCount}, Failed: ${result.failedCount}, Total: ${result.totalPending}`);
      } catch (error) {
        anyFailed = true;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.operationLogService.log('error', `FRP dependency resolution failed: ${errorMessage}`);
      }
    }

    this.operationLogService.log('system', `<<< Task finished. Status: ${anyFailed ? 'failed' : 'succeeded'}`);

    await this.operationLogService.updateStatus(opId, anyFailed ? 'ERROR' : 'COMPLETED');
  }
}
