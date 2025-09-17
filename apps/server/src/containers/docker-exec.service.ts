import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { SshService, SshExecOptions } from '../ssh/ssh.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from '../operation-log/operation-log.service';

@Injectable()
export class DockerExecService {
  constructor(
    private readonly ssh: SshService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly operationLogService: OperationLogService,
  ) {}

  /**
   * 判断 Docker 命令是否需要网络访问（需要代理）
   */
  private needsNetworkAccess(args: string[]): boolean {
    if (!args.length) return false;

    const command = args[0];
    const networkCommands = ['pull', 'push', 'search', 'login', 'logout'];

    // manifest inspect 和 buildx imagetools 也需要网络
    if (command === 'manifest' && args[1] === 'inspect') {
      return true;
    }

    if (command === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
      return true;
    }

    return networkCommands.includes(command);
  }

  /**
   * 确保 Docker 已登录（如果配置了凭证）
   */
  private async ensureDockerLogin(host: {
    address: string;
    sshUser: string;
    port?: number;
    password?: string;
    privateKey?: string;
    privateKeyPassphrase?: string;
  }): Promise<boolean> {
    try {
      const appSettings = await this.settings.get();

      if (
        !appSettings.dockerCredentialsEnabled ||
        !appSettings.dockerCredentialsUsername ||
        !appSettings.dockerCredentialsPersonalAccessToken
      ) {
        return false;
      }

      // 检查是否已经登录
      const { code: infoCode } = await this.exec(host, ['info'], 30);
      if (infoCode !== 0) {
        this.operationLogService.log('info', `⚠️ Docker daemon 不可用: ${host.address}`);
        return false;
      }

      // 尝试登录 Docker Hub
      // 使用与 exec 方法相同的 login shell 包装，确保 Docker 在 PATH 中
      const loginCmd = `echo "${appSettings.dockerCredentialsPersonalAccessToken}" | docker login --username "${appSettings.dockerCredentialsUsername}" --password-stdin`;
      const wrappedLoginCmd = `sh -lc "${loginCmd.replace(/"/g, '\\"')}"`;
      const { code: loginCode, stderr: loginStderr } = await this.execShell(host, wrappedLoginCmd);

      if (loginCode === 0) {
        this.operationLogService.log('info', `✅ Docker凭证登录成功: ${host.address}`);
        return true;
      } else {
        this.operationLogService.log('error', `❌ Docker凭证登录失败: ${host.address} - ${loginStderr}`);
        return false;
      }
    } catch (error) {
      this.operationLogService.log('error',
        `❌ Docker凭证登录过程出错: ${host.address} - ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * 构建 Docker 代理环境变量
   */
  private async buildProxyEnv(hostAddress?: string, dockerArgs?: string[]): Promise<string> {
    try {
      const appSettings = await this.settings.get();

      if (!appSettings.dockerProxyEnabled || !appSettings.dockerProxyHost) {
        return '';
      }

      // 只对需要网络访问的命令应用代理
      if (dockerArgs && !this.needsNetworkAccess(dockerArgs)) {
        return '';
      }

      // 对于需要网络访问的命令，优先使用 Docker 凭证（如果配置了）
      if (dockerArgs && this.needsNetworkAccess(dockerArgs)) {
        // 这里不直接调用 ensureDockerLogin，而是在具体执行时调用
        // 避免在构建环境变量时进行登录操作
      }

      // 如果启用了仅对本地主机应用代理的选项
      if (appSettings.dockerProxyLocalOnly && hostAddress) {
        try {
          const host = await this.prisma.host.findFirst({
            where: { address: hostAddress },
          });

          // 如果找不到主机信息或主机role不是'local'，则不应用代理
          if (!host || host.role !== 'local') {
            return '';
          }
        } catch (dbError) {
          this.operationLogService.log('info', `⚠️ Failed to query host information for proxy filtering: ${dbError}`);
          return '';
        }
      }

      const proxyHost = appSettings.dockerProxyHost;
      const proxyPort = appSettings.dockerProxyPort || 8080;
      const username = appSettings.dockerProxyUsername || '';
      const password = appSettings.dockerProxyPassword || '';

      // 构建代理 URL
      let proxyUrl = '';
      if (username && password) {
        proxyUrl = `http://${username}:${password}@${proxyHost}:${proxyPort}`;
      } else {
        proxyUrl = `http://${proxyHost}:${proxyPort}`;
      }

      // 构建环境变量字符串
      const envVars = [
        `HTTP_PROXY="${proxyUrl}"`, 
        `HTTPS_PROXY="${proxyUrl}"`, 
        `http_proxy="${proxyUrl}"`, 
        `https_proxy="${proxyUrl}"`, 
        `NO_PROXY="localhost,127.0.0.1,::1"`,
      ];

      return envVars.join(' ');
    } catch (error) {
      this.operationLogService.log('info', `⚠️ Failed to build proxy environment variables: ${error}`);
      return '';
    }
  }

  async execShell(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    shellCommand: string,
    options: SshExecOptions = {} as any,
  ): Promise<{ code: number; stdout: string | Buffer; stderr: string | Buffer; cmd: string }> {
    const isLocal = host.address === '127.0.0.1' || host.address === 'localhost';
    const timeoutSec = (options as any).timeoutSec || 60;
    const encoding = options.encoding || 'utf8';

    if (isLocal) {
      return new Promise(resolve => {
        const p = spawn('sh', ['-c', shellCommand]);
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        const timer = setTimeout(() => {
          try {
            p.kill('SIGKILL');
          } catch {
            // ignore process kill errors
          } 
        }, timeoutSec * 1000);

        p.stdout.on('data', d => stdoutChunks.push(d));
        p.stderr.on('data', d => stderrChunks.push(d));

        p.on('exit', code => {
          clearTimeout(timer);
          const stdout =
            encoding === 'utf8' ? Buffer.concat(stdoutChunks).toString('utf8') : Buffer.concat(stdoutChunks);
          const stderr =
            encoding === 'utf8' ? Buffer.concat(stderrChunks).toString('utf8') : Buffer.concat(stderrChunks);
          resolve({ code: code ?? 1, stdout, stderr, cmd: shellCommand });
        });
        p.on('error', err => {
          clearTimeout(timer);
          const stderr = Buffer.from(err.message);
          resolve({
            code: 1,
            stdout: Buffer.alloc(0),
            stderr: encoding === 'utf8' ? stderr.toString('utf8') : stderr,
            cmd: shellCommand,
          });
        });
      });
    }

    const res = await this.ssh.executeCapture({
      host: host.address,
      user: host.sshUser,
      port: host.port,
      command: shellCommand,
      connectTimeoutSeconds: Math.min(30, Math.max(5, Math.floor(timeoutSec / 2))),
      killAfterSeconds: timeoutSec,
      hostKeyCheckingMode: 'accept-new',
      password: host.password,
      privateKey: host.privateKey,
      privateKeyPassphrase: host.privateKeyPassphrase,
      encoding,
    });
    const cmd = `ssh ${host.sshUser}@${host.address} -- ${shellCommand}`;
    return { code: res.code, stdout: res.stdout, stderr: res.stderr, cmd };
  }

  async execStreaming(
    host: {
      id: string;
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    args: string[],
    timeoutSec = 60,
  ): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    const isLocal = host.address === '127.0.0.1' || host.address === 'localhost';

    if (this.needsNetworkAccess(args)) {
      await this.ensureDockerLogin(host);
    }

    const proxyEnv = await this.buildProxyEnv(host.address, args);
    const envPrefix = proxyEnv ? `${proxyEnv} ` : '';

    // Properly escape arguments for shell execution
    const escapedArgs = args.map(arg => {
      // If argument contains special characters, quote it properly
      if (arg.includes('{{') || arg.includes('}}') || arg.includes(' ') || arg.includes('|') || arg.includes('"')) {
        // Escape single quotes within the argument and wrap in single quotes
        return `'${arg.replace(/'/g, "'\"'\"'")}'`;
      }
      return arg;
    });

    const dockerCmd = `${envPrefix}docker ${escapedArgs.join(' ')}`;
    const wrapped = `sh -lc "${dockerCmd.replace(/"/g, '\\"')}"`;

    if (isLocal) {
      // 本机也走统一的 shell 包裹，避免 format/转义差异
      // TODO: Implement local streaming execution
      throw new Error('Local streaming execution is not implemented yet.');
    }

    const res = await this.ssh.execWithStreaming(
      {
        host: host.address,
        user: host.sshUser,
        port: host.port,
        command: wrapped,
        connectTimeoutSeconds: Math.min(30, Math.max(5, Math.floor(timeoutSec / 2))),
        killAfterSeconds: timeoutSec,
        hostKeyCheckingMode: 'accept-new',
        password: host.password,
        privateKey: host.privateKey,
        privateKeyPassphrase: host.privateKeyPassphrase,
      },
      host.id,
    );

    const cmd = `ssh -o StrictHostKeyChecking=yes ${host.sshUser}@${host.address} -- ${wrapped}`;
    return { code: res.code, stdout: res.stdout.toString(), stderr: res.stderr.toString(), cmd };
  }

  async exec(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    args: string[],
    timeoutSec = 60,
  ): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    const isLocal = host.address === '127.0.0.1' || host.address === 'localhost';

    // 对于需要网络访问的命令，优先使用 Docker 凭证
    if (this.needsNetworkAccess(args)) {
      await this.ensureDockerLogin(host);
    }

    // 构建代理环境变量
    const proxyEnv = await this.buildProxyEnv(host.address, args);
    const envPrefix = proxyEnv ? `${proxyEnv} ` : '';

    // Properly escape arguments for shell execution
    const escapedArgs = args.map(arg => {
      // If argument contains special characters, quote it properly
      if (arg.includes('{{') || arg.includes('}}') || arg.includes(' ') || arg.includes('|') || arg.includes('"')) {
        // Escape single quotes within the argument and wrap in single quotes
        return `'${arg.replace(/'/g, "'\"'\"'")}'`;
      }
      return arg;
    });

    const dockerCmd = `${envPrefix}docker ${escapedArgs.join(' ')}`;
    const wrapped = `sh -lc "${dockerCmd.replace(/"/g, '\\"')}"`;
    if (isLocal) {
      // 本机也走统一的 shell 包裹，避免 format/转义差异
      return new Promise(resolve => {
        const p = spawn('sh', ['-lc', dockerCmd]);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          try {
            p.kill('SIGKILL');
          } catch {
            // ignore process kill errors
          }
        }, timeoutSec * 1000);
        p.stdout.setEncoding('utf8');
        p.stderr.setEncoding('utf8');
        p.stdout.on('data', d => (stdout += d));
        p.stderr.on('data', d => (stderr += d));
        p.on('exit', code => {
          clearTimeout(timer);
          resolve({ code: code ?? 1, stdout, stderr, cmd: wrapped });
        });
        p.on('error', () => {
          clearTimeout(timer);
          resolve({ code: 1, stdout, stderr, cmd: wrapped });
        });
      });
    }
    const res = await this.ssh.executeCapture({
      host: host.address,
      user: host.sshUser,
      port: host.port,
      command: wrapped,
      connectTimeoutSeconds: Math.min(30, Math.max(5, Math.floor(timeoutSec / 2))),
      killAfterSeconds: timeoutSec,
      hostKeyCheckingMode: 'accept-new',
      password: host.password,
      privateKey: host.privateKey,
      privateKeyPassphrase: host.privateKeyPassphrase,
    });
    const cmd = `ssh -o StrictHostKeyChecking=yes ${host.sshUser}@${host.address} -- ${wrapped}`;
    return { code: res.code, stdout: res.stdout.toString(), stderr: res.stderr.toString(), cmd };
  }

  // 带重试机制的执行方法，用于处理网络连接错误
  async execWithRetry(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    args: string[],
    timeoutSec = 60,
    maxRetries = 3,
  ): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.exec(host, args, timeoutSec);

        // 如果成功或者是非网络错误，直接返回
        if (result.code === 0 || !this.isNetworkError(result.stderr)) {
          return result;
        }

        // 如果是网络错误且还有重试次数，记录错误并继续重试
        lastError = result;
        if (attempt < maxRetries) {
          // 指数退避：第1次重试等待2秒，第2次等待4秒
          const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 8000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 8000);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
      }
    }

    // 如果所有重试都失败，返回最后一次的错误
    if (lastError && typeof lastError === 'object' && 'code' in lastError) {
      return lastError;
    }

    return { code: 1, stdout: '', stderr: `重试 ${maxRetries} 次后仍然失败`, cmd: `docker ${args.join(' ')}` };
  }

  // 判断是否为网络相关错误
  private isNetworkError(stderr: string): boolean {
    const networkErrorPatterns = [
      'EOF',
      'connection reset',
      'connection refused',
      'timeout',
      'network is unreachable',
      'no route to host',
      'temporary failure in name resolution',
      'unable to reach registry',
    ];

    const lowerStderr = stderr.toLowerCase();
    return networkErrorPatterns.some(pattern => lowerStderr.includes(pattern));
  }
}
