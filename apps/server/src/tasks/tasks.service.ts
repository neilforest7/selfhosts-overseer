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

  async exec(req: ExecRequest): Promise<OperationLog> {
    const { opId, command, targets } = req;
    console.log(`🎯 Starting task for opId: ${opId}, command: ${command}`);

    await this.operationLogService.updateStatus(opId, 'RUNNING');

    // Fire-and-forget execution
    void this.runTask(opId, command, targets).catch(async (err) => {
      console.error(`Task ${opId} failed unexpectedly:`, err);
      await this.operationLogService.addLogEntry(opId, {
        stream: 'error',
        content: `An unexpected error occurred: ${err.message}`,
      });
      await this.operationLogService.updateStatus(opId, 'ERROR');
    });

    return this.prisma.operationLog.findUnique({ where: { id: opId } });
  }

  private async runTask(opId: string, command: string, targets: string[]): Promise<void> {
    await this.operationLogService.updateStatus(opId, 'RUNNING');
    const settings = await this.settingsService.get();
    const { items: allHosts } = await this.hostsService.list(undefined, 1000);
    const targetHosts = targets.map((tid) => allHosts.find((h) => h.id === tid)).filter(Boolean) as any[];

    let anyFailed = false;
    const logsBuffer: { stream: string; content: string; hostId?: string; timestamp: Date }[] = [];

    const addEntry = (stream: string, content: string, hostId?: string) => {
      const entryData = { stream, content, hostId, timestamp: new Date() };
      logsBuffer.push(entryData);
      // For real-time UI, we add a temporary client-side ID
      this.gateway.broadcast(opId, stream, { ...entryData, id: `temp_${Date.now()}_${Math.random()}` });
    };

    addEntry('system', `>>> Task started: command "${command}" on ${targetHosts.length} targets.`);

    const runOne = async (target: any) => {
      if (command === 'internal:discover_containers') {
        try {
          await this.containersService.discoverOnHost(target, opId, (log) => {
            addEntry('info', log, target.id);
          });
        } catch (err) {
          anyFailed = true;
          addEntry('error', `[${target.name}] Discovery failed: ${err.message}`, target.id);
        }
        return;
      }

      const prefix = `[${target.name}@${target.address}] `;
      addEntry('system', `${prefix}>>> Starting execution...`, target.id);

      const hostDetail = await this.prisma.host.findUnique({ where: { id: target.id } });
      if (!hostDetail) {
        anyFailed = true;
        addEntry('error', `${prefix}Host details not found.`, target.id);
        return;
      }
      
      const decPassword = this.crypto.decryptString(hostDetail.sshPassword);
      const decKey = this.crypto.decryptString(hostDetail.sshPrivateKey);
      const decPassphrase = this.crypto.decryptString(hostDetail.sshPrivateKeyPassphrase);

      const code = await this.sshService.execute({
        host: target.address,
        user: target.sshUser,
        port: target.port,
        password: decPassword,
        privateKey: decKey,
        privateKeyPassphrase: decPassphrase,
        command: command,
        connectTimeoutSeconds: 30,
        killAfterSeconds: 100,
        onStdout: (chunk) => addEntry('stdout', `${prefix}${chunk.toString()}`, target.id),
        onStderr: (chunk) => addEntry('stderr', `${prefix}${chunk.toString()}`, target.id),
      });

      if (code !== 0) anyFailed = true;
      addEntry('system', `${prefix}<<< Finished with exit code ${code}.`, target.id);
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

    addEntry('system', `<<< Task finished. Status: ${anyFailed ? 'failed' : 'succeeded'}`);
    
    if (logsBuffer.length > 0) {
      await this.operationLogService.addLogEntries(opId, logsBuffer);
    }

    await this.operationLogService.updateStatus(opId, anyFailed ? 'ERROR' : 'COMPLETED');
    this.gateway.broadcast(opId, 'end', { status: anyFailed ? 'failed' : 'succeeded' });
  }
}
