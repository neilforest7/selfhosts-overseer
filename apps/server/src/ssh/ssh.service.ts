import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { OperationLogService } from '../operation-log/operation-log.service';

export interface SshExecOptions {
  host: string;
  user: string;
  port?: number;
  command: string;
  connectTimeoutSeconds?: number; // SSH connect timeout
  killAfterSeconds: number; // hard kill after this timeout
  onStdout?: (chunk: string | Buffer) => void;
  onStderr?: (chunk: string | Buffer) => void;
  encoding?: 'utf8' | 'binary';
  // auth (optional)
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
  hostKeyCheckingMode?: 'yes' | 'accept-new' | 'no';
}

@Injectable()
export class SshService {
  constructor(private readonly operationLogService: OperationLogService) {}

  async execute(options: SshExecOptions): Promise<number> {
    const res = await this.executeCapture(options);
    return res.code;
  }

  private async buildSshArgs(options: SshExecOptions) {
    const { host, user, port, command, connectTimeoutSeconds = 10 } = options;
    const hk = options.hostKeyCheckingMode ?? 'accept-new';

    const baseArgs = [
      '-o',
      'BatchMode=yes',
      '-o',
      `StrictHostKeyChecking=${hk}`,
      '-o',
      `ConnectTimeout=${Math.max(1, Math.min(600, connectTimeoutSeconds))}`,
    ];
    if (port) baseArgs.push('-p', String(port));
    // auth via private key
    let cleanup: (() => Promise<void>) | undefined;
    if (options.privateKey) {
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const keyPath = path.join(os.tmpdir(), `key_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      await fs.writeFile(keyPath, options.privateKey, { mode: 0o600 });
      baseArgs.push('-o', 'IdentitiesOnly=yes', '-i', keyPath);
      cleanup = async () => {
        try {
          await fs.unlink(keyPath);
        } catch {} // ignore error
      };
    }

    const sshTarget = `${user}@${host}`;
    const finalArgs = [...baseArgs, sshTarget, '--', command];

    const hasPassword = !!options.password;
    const hasKeyPass = !!options.privateKeyPassphrase;
    const useSshPass = hasPassword || hasKeyPass;
    const commandBin = useSshPass ? 'sshpass' : 'ssh';
    const sshpassArgs: string[] = [];
    if (useSshPass) {
      sshpassArgs.push('-p', String(options.password ?? options.privateKeyPassphrase));
      if (hasKeyPass && !hasPassword) {
        // match key passphrase prompt
        sshpassArgs.push('-P', 'Enter passphrase for key');
      }
    }
    // Prefer correct auth order
    if (hasPassword && !options.privateKey) {
      finalArgs.unshift('-o', 'PubkeyAuthentication=no');
      finalArgs.unshift('-o', 'PreferredAuthentications=password');
    } else {
      finalArgs.unshift('-o', 'PreferredAuthentications=publickey,password');
    }

    const commandArgs = useSshPass ? [...sshpassArgs, 'ssh', ...finalArgs] : finalArgs;
    return { commandBin, commandArgs, cleanup };
  }

  async execWithStreaming(
    options: SshExecOptions,
    taskId: string,
    hostId?: string,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    const { killAfterSeconds } = options;
    const { commandBin, commandArgs, cleanup } = await this.buildSshArgs(options);

    return await new Promise(resolve => {
      const child = spawn(commandBin, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let timeout: NodeJS.Timeout | undefined;
      if (killAfterSeconds > 0) {
        timeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {} // ignore error
        }, killAfterSeconds * 1000);
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const handleData = (stream: 'stdout' | 'stderr', chunks: Buffer[]) => (data: Buffer) => {
        chunks.push(data);
        const lines = data.toString('utf8').split('\n').filter(line => line.length > 0);
        for (const line of lines) {
          this.operationLogService.log(taskId, stream, line, hostId);
        }
      };

      child.stdout.on('data', handleData('stdout', stdoutChunks));
      child.stderr.on('data', handleData('stderr', stderrChunks));

      const done = (code: number) => {
        if (timeout) clearTimeout(timeout);
        const finish = async () => {
          if (cleanup) await cleanup();
          const stdout = Buffer.concat(stdoutChunks).toString('utf8');
          const stderr = Buffer.concat(stderrChunks).toString('utf8');
          resolve({ code, stdout, stderr });
        };
        void finish();
      };
      child.on('exit', code => done(code ?? 1));
      child.on('error', () => done(1));
    });
  }

  async executeCapture(
    options: SshExecOptions,
  ): Promise<{ code: number; stdout: string | Buffer; stderr: string | Buffer }> {
    const { killAfterSeconds, onStdout, onStderr } = options;
    const encoding = options.encoding ?? 'utf8';
    const { commandBin, commandArgs, cleanup } = await this.buildSshArgs(options);

    return await new Promise<{ code: number; stdout: string | Buffer; stderr: string | Buffer }>(resolve => {
      const child = spawn(commandBin, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let timeout: NodeJS.Timeout | undefined;
      if (killAfterSeconds > 0) {
        timeout = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {} // ignore error
        }, killAfterSeconds * 1000);
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on('data', (d: Buffer) => {
        stdoutChunks.push(d);
        onStdout?.(d);
      });
      child.stderr.on('data', (d: Buffer) => {
        stderrChunks.push(d);
        onStderr?.(d);
      });

      const done = (code: number) => {
        if (timeout) clearTimeout(timeout);
        const finish = async () => {
          if (cleanup) await cleanup();
          const stdout = encoding === 'utf8' ? Buffer.concat(stdoutChunks).toString('utf8') : Buffer.concat(stdoutChunks);
          const stderr = encoding === 'utf8' ? Buffer.concat(stderrChunks).toString('utf8') : Buffer.concat(stderrChunks);
          resolve({ code, stdout, stderr });
        };
        void finish();
      };
      child.on('exit', code => done(code ?? 1));
      child.on('error', () => done(1));
    });
  }
}

