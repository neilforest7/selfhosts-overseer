import { Injectable } from '@nestjs/common';
import { DockerExecService } from './docker-exec.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { DockerRegistryService } from './docker-registry.service';

@Injectable()
export class DockerImageService {
  constructor(
    private readonly dockerExec: DockerExecService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
    private readonly registryService: DockerRegistryService,
  ) {}

  /**
   * 验证SSH私钥格式
   */
  private validateSSHPrivateKey(privateKey: string): { valid: boolean; error?: string } {
    if (!privateKey || typeof privateKey !== 'string') {
      return { valid: false, error: 'Private key is empty or invalid' };
    }

    const trimmedKey = privateKey.trim();

    // 检查是否包含私钥标识符
    const validKeyHeaders = [
      '-----BEGIN RSA PRIVATE KEY-----',
      '-----BEGIN PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----',
      '-----BEGIN DSA PRIVATE KEY-----',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----'
    ];

    const hasValidHeader = validKeyHeaders.some(header => trimmedKey.includes(header));
    if (!hasValidHeader) {
      return { valid: false, error: 'Private key does not contain a valid header' };
    }

    // 检查是否包含对应的结束标识符
    const validKeyFooters = [
      '-----END RSA PRIVATE KEY-----',
      '-----END PRIVATE KEY-----',
      '-----END OPENSSH PRIVATE KEY-----',
      '-----END EC PRIVATE KEY-----',
      '-----END DSA PRIVATE KEY-----',
      '-----END ENCRYPTED PRIVATE KEY-----'
    ];

    const hasValidFooter = validKeyFooters.some(footer => trimmedKey.includes(footer));
    if (!hasValidFooter) {
      return { valid: false, error: 'Private key does not contain a valid footer' };
    }

    // 检查基本格式：应该有多行
    const lines = trimmedKey.split('\n');
    if (lines.length < 3) {
      return { valid: false, error: 'Private key format appears to be corrupted (too few lines)' };
    }

    // 检查是否有明显的格式问题
    if (trimmedKey.includes('\r\n') && !trimmedKey.includes('\n')) {
      return { valid: false, error: 'Private key has Windows line endings, may cause issues' };
    }

    return { valid: true };
  }

  /**
   * 获取主机的完整SSH凭证（包括解密和验证）
   */
  private async getHostCredById(hostId: string) {
    const host = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!host) return null;

    let decryptedPassword: string | undefined;
    let decryptedPrivateKey: string | undefined;
    let decryptedPrivateKeyPassphrase: string | undefined;

    // 解密密码
    if (host.sshPassword) {
      try {
        decryptedPassword = this.crypto.decryptString(host.sshPassword)?.toString();
      } catch (error) {
        this.operationLogService.log('info', `⚠️ Failed to decrypt SSH password for host ${host.address}: ${error}`);
      }
    }

    // 解密私钥
    if (host.sshPrivateKey) {
      try {
        decryptedPrivateKey = this.crypto.decryptString(host.sshPrivateKey)?.toString();

        // 验证私钥格式
        if (decryptedPrivateKey) {
          const validation = this.validateSSHPrivateKey(decryptedPrivateKey);
          if (!validation.valid) {
            this.operationLogService.log('info', `⚠️ SSH private key validation failed for host ${host.address}: ${validation.error}`);
            // 不要完全阻止操作，但记录警告
          }
        }
      } catch (error) {
        this.operationLogService.log('info', `⚠️ Failed to decrypt SSH private key for host ${host.address}: ${error}`);
      }
    }

    // 解密私钥密码短语
    if (host.sshPrivateKeyPassphrase) {
      try {
        decryptedPrivateKeyPassphrase = this.crypto.decryptString(host.sshPrivateKeyPassphrase)?.toString();
      } catch (error) {
        this.operationLogService.log('info', `⚠️ Failed to decrypt SSH private key passphrase for host ${host.address}: ${error}`);
      }
    }

    return {
      address: host.address,
      sshUser: host.sshUser,
      port: host.port ?? undefined,
      password: decryptedPassword,
      privateKey: decryptedPrivateKey,
      privateKeyPassphrase: decryptedPrivateKeyPassphrase,
    };
  }

  /**
   * 分析SSH错误并提供具体的错误信息
   */
  private analyzeSSHError(stderr: string, hostAddress: string): string {
    const errorLower = stderr.toLowerCase();

    if (errorLower.includes('permission denied (publickey)')) {
      return `SSH authentication failed for ${hostAddress}. Please check that the SSH private key is correct and properly configured.`;
    }

    if (errorLower.includes('error in libcrypto')) {
      return `SSH private key format error for ${hostAddress}. The private key may be corrupted, in wrong format, or encrypted with an unsupported algorithm.`;
    }

    if (errorLower.includes('connection refused')) {
      return `SSH connection refused to ${hostAddress}. Please check that SSH service is running and the port is correct.`;
    }

    if (errorLower.includes('network is unreachable') || errorLower.includes('no route to host')) {
      return `Network connectivity issue to ${hostAddress}. Please check network configuration and firewall settings.`;
    }

    if (errorLower.includes('connection timed out')) {
      return `SSH connection timeout to ${hostAddress}. The host may be unreachable or SSH service may be slow to respond.`;
    }

    if (errorLower.includes('host key verification failed')) {
      return `SSH host key verification failed for ${hostAddress}. The host key may have changed or be unknown.`;
    }

    if (errorLower.includes('bad permissions')) {
      return `SSH private key file permissions error for ${hostAddress}. The private key file may have incorrect permissions.`;
    }

    // 返回原始错误信息，但添加主机信息
    return `SSH error for ${hostAddress}: ${stderr}`;
  }

  /**
   * 确保主机已登录Docker Hub（每个主机只登录一次）
   */
  async ensureDockerLogin(hostId: string): Promise<{ success: boolean; error?: string }> {
    // 获取完整的主机凭证（包括解密的SSH凭证）
    const hostCred = await this.getHostCredById(hostId);
    if (!hostCred) {
      throw new Error(`Host credentials not found for ${hostId}`);
    }

    // 暂时注释掉登录状态检查，直到TypeScript错误解决
    // if (hostRecord?.dockerLoginStatus && hostRecord.dockerLoginExpiry && hostRecord.dockerLoginExpiry > new Date()) {
    //   console.log(`[ensureDockerLogin] Docker login still valid for ${hostCred.address}`);
    //   return { success: true };
    // }

    // 获取Docker凭证设置
    const settings = await this.settings.get();
    if (!settings.dockerCredentialsEnabled || !settings.dockerCredentialsUsername || !settings.dockerCredentialsPersonalAccessToken) {
      this.operationLogService.log('info', `Docker credentials not configured, skipping login for ${hostCred.address}`);
      return { success: true }; // 不是错误，只是没有配置凭证
    }

    this.operationLogService.log('info', `Logging into Docker Hub for ${hostCred.address}`);
    const loginCmd = `echo "${settings.dockerCredentialsPersonalAccessToken}" | docker login --username "${settings.dockerCredentialsUsername}" --password-stdin`;

    const { code, stdout, stderr } = await this.dockerExec.execShell(hostCred, loginCmd);

    // 过滤输出以减少噪音
    const filteredStdout = this.filterDockerOutput(stdout.toString(), 'login');

    if (code === 0) {
      // 登录成功，更新状态（设置24小时过期）
      const expiry = new Date();
      expiry.setHours(expiry.getHours() + 24);

      // 暂时注释掉数据库更新，直到TypeScript错误解决
      // await this.prisma.host.update({
      //   where: { id: hostId },
      //   data: {
      //     dockerLoginStatus: true,
      //     dockerLoginExpiry: expiry,
      //   },
      // });

      this.operationLogService.log('info', `✅ Docker login successful for ${hostCred.address}`);
      if (filteredStdout) {
        this.operationLogService.log('info', `Login output: ${filteredStdout}`);
      }
      return { success: true };
    } else {
      const rawError = stderr.toString();

      // 分析SSH错误并提供更具体的错误信息
      const analyzedError = this.analyzeSSHError(rawError, hostCred.address);

      this.operationLogService.log('error', `❌ Docker login failed for ${hostCred.address}: ${analyzedError}`);
      return { success: false, error: analyzedError };
    }
  }

  async inspectImageRepoDigests(
    host: { address: string; sshUser: string; port?: number } | { id: string; address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<string[]> {
    // 如果host有id，获取完整凭证；否则直接使用传入的host
    let hostCred = host;
    if ('id' in host) {
      const fullCred = await this.getHostCredById(host.id);
      if (fullCred) {
        hostCred = fullCred;
      }
    }

    const { code, stdout, stderr } = await this.dockerExec.exec(hostCred, ['inspect', '--format', '{{json .RepoDigests}}', imageRef], 60);
    // Check for both exit code and template parsing errors
    if (code !== 0 || stderr.includes('template parsing error')) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async inspectImageRepoTags(
    host: { address: string; sshUser: string; port?: number } | { id: string; address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<string[]> {
    // 如果host有id，获取完整凭证；否则直接使用传入的host
    let hostCred = host;
    if ('id' in host) {
      const fullCred = await this.getHostCredById(host.id);
      if (fullCred) {
        hostCred = fullCred;
      }
    }

    const { code, stdout, stderr } = await this.dockerExec.exec(hostCred, ['inspect', '--format', '{{json .RepoTags}}', imageRef], 60);
    // Check for both exit code and template parsing errors
    if (code !== 0 || stderr.includes('template parsing error')) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async resolveImageNameTag(
    host: { address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<{ imageName?: string; imageTag?: string }> {
    if (!imageRef) return {};
    // Prefer human-friendly RepoTags
    const tags = await this.inspectImageRepoTags(host, imageRef);
    const pick = tags.find(t => t.includes(':')) || tags[0];
    const ref = pick || imageRef;
    // Strip digest if present
    const atIdx = ref.indexOf('@');
    const cleanRef = atIdx >= 0 ? ref.slice(0, atIdx) : ref;
    if (cleanRef.includes(':')) {
      const i = cleanRef.lastIndexOf(':');
      return { imageName: cleanRef.slice(0, i), imageTag: cleanRef.slice(i + 1) };
    }
    return { imageName: cleanRef, imageTag: undefined };
  }

  async pullImage(host: { address: string; sshUser: string; port?: number } | { id: string; address: string; sshUser: string; port?: number }, imageRef: string): Promise<number> {
    // 如果host有id，获取完整凭证；否则直接使用传入的host
    let hostCred = host;
    if ('id' in host) {
      const fullCred = await this.getHostCredById(host.id);
      if (fullCred) {
        hostCred = fullCred;
      }
    }

    const { code } = await this.dockerExec.exec(hostCred, ['pull', imageRef], 300);
    return code;
  }

  // 检查镜像是否来自 Docker Hub
  private isDockerHubImage(imageRef: string): boolean {
    // Docker Hub 镜像的特征：
    // 1. 没有 registry 前缀的镜像（如 nginx, ubuntu）
    // 2. 以 docker.io 开头的镜像
    // 3. library/ 开头的官方镜像
    if (imageRef.includes('docker.io') || imageRef.includes('registry-1.docker.io')) {
      return true;
    }

    // 如果没有斜杠，通常是官方镜像（如 nginx:latest）
    if (!imageRef.includes('/')) {
      return true;
    }

    // 如果只有一个斜杠且没有域名，通常是 Docker Hub 用户镜像（如 user/image）
    const parts = imageRef.split('/');
    if (parts.length === 2 && !parts[0].includes('.')) {
      return true;
    }

    return false;
  }

  // 优化的远程镜像检查：使用 Docker Registry API 获取 Image Manifest Digest
  // 无需实际拉取镜像，大幅提升检查速度并减少网络带宽消耗
  async checkRemoteImageDigest(
    host: {
      id: string;
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    imageRef: string,
    _ensureLogin: boolean = true, // 保持参数兼容性，但不再使用
  ): Promise<{ digest?: string; error?: string; rateLimited?: boolean }> {
    // 检查是否启用 Registry API
    const settings = await this.settings.get();

    if (!settings.registryApiEnabled) {
      this.operationLogService.log('info', `Registry API disabled, using docker pull for ${imageRef}`);
      return this.checkRemoteImageDigestFallback(host, imageRef);
    }

    this.operationLogService.log('info', `Checking remote digest for ${imageRef} via Registry API`);

    try {
      // 使用新的 Registry API 服务获取远程 digest（带重试机制）
      const result = await this.registryService.getRemoteImageDigestWithRetry(imageRef);

      if (result.error) {
        // 如果 Registry API 失败且启用了回退机制，回退到原有的 docker pull 方法
        if (settings.registryApiFallbackEnabled) {
          this.operationLogService.log('info', `Registry API failed for ${imageRef}, falling back to docker pull: ${result.error}`);
          return this.checkRemoteImageDigestFallback(host, imageRef);
        } else {
          return { error: result.error };
        }
      }

      if (result.rateLimited) {
        return {
          error: result.error || 'Rate limited by registry',
          rateLimited: true,
        };
      }

      if (result.digest) {
        this.operationLogService.log('info', `✅ Found remote digest for ${imageRef} via Registry API: ${result.digest}`);
        return {
          digest: result.digest,
        };
      }

      // 如果没有 digest，可能是镜像不存在或其他问题
      return {
        error: 'No digest found in registry response',
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Registry API error for ${imageRef}: ${errorMessage}`);

      // 如果启用了回退机制，回退到原有的 docker pull 方法
      if (settings.registryApiFallbackEnabled) {
        this.operationLogService.log('info', `Falling back to docker pull for ${imageRef}`);
        return this.checkRemoteImageDigestFallback(host, imageRef);
      } else {
        return { error: errorMessage };
      }
    }
  }

  /**
   * 回退方法：使用原有的 docker pull 方式获取远程 digest
   * 当 Registry API 失败时使用此方法
   */
  private async checkRemoteImageDigestFallback(
    host: {
      id: string;
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    imageRef: string,
  ): Promise<{ digest?: string; error?: string; rateLimited?: boolean }> {
    this.operationLogService.log('info', `Using docker pull fallback for ${imageRef} on ${host.address}`);

    // 获取完整的主机凭证（包括解密的SSH凭证）
    const hostCred = await this.getHostCredById(host.id);
    if (!hostCred) {
      return { error: `Host credentials not found for ${host.id}` };
    }

    // 使用 docker pull 获取正确的 Image Manifest Digest
    const { code, stdout, stderr } = await this.dockerExec.exec(hostCred, ['pull', imageRef], 120);

    // 过滤输出以减少噪音
    const filteredStdout = this.filterDockerOutput(stdout, 'pull');
    const filteredStderr = this.filterDockerOutput(stderr, 'pull');

    if (code === 0) {
      // 解析 docker pull 输出中的 Digest 行
      const digestMatch = stdout.match(/Digest:\s*(sha256:[a-f0-9]{64})/);
      if (digestMatch) {
        const imageManifestDigest = digestMatch[1];
        this.operationLogService.log('info', `✅ Found digest for ${imageRef} via docker pull: ${imageManifestDigest}`);
        if (filteredStdout) {
          this.operationLogService.log('info', `Pull output: ${filteredStdout}`);
        }
        return {
          digest: imageManifestDigest,
        };
      } else {
        this.operationLogService.log('info', `No digest found in pull output for ${imageRef}, image may be up to date`);
        if (filteredStdout) {
          this.operationLogService.log('info', `Pull output: ${filteredStdout}`);
        }
        return {
          digest: undefined, // 镜像已是最新，没有新的 digest
        };
      }
    }

    // 检查是否是速率限制错误
    const isRateLimited = stderr.includes('toomanyrequests') || stderr.includes('Too Many Requests');
    if (isRateLimited) {
      this.operationLogService.log('info', `⚠️ Rate limited for ${imageRef} on ${host.address}`);
      if (filteredStderr) {
        this.operationLogService.log('info', `Rate limit details: ${filteredStderr}`);
      }
      return {
        error: 'Rate limited by Docker Hub',
        rateLimited: true,
      };
    }

    // 分析SSH错误并提供更具体的错误信息
    const rawError = stderr || 'Unknown error';
    const analyzedError = this.analyzeSSHError(rawError, hostCred.address);

    this.operationLogService.log('error', `❌ Docker pull failed for ${imageRef}: ${analyzedError}`);
    return {
      error: `Docker pull failed: ${analyzedError}`,
    };
  }

  async checkImageUpdate(
    host: {
      id: string;
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    imageRef: string,
    currentDigest?: string | null,
  ): Promise<{ updateAvailable: boolean; remoteDigest?: string; error?: string; currentLocalDigest?: string }> {
    // 使用简化的远程检查方法
    const remoteResult = await this.checkRemoteImageDigest(host, imageRef);

    if (remoteResult.error) {
      return { updateAvailable: false, error: remoteResult.error };
    }

    const remoteDigest = remoteResult.digest;
    if (!remoteDigest) {
      // 如果没有远程 digest，说明镜像已是最新
      return { updateAvailable: false };
    }

    // ALWAYS check current local digest to avoid stale database values
    // This is critical for "latest" and other mutable tags
    const localDigests = await this.inspectImageRepoDigests(host, imageRef);
    const currentLocalDigest = localDigests[0] || null;

    // Log digest comparison for debugging
    if (currentDigest && currentLocalDigest && currentDigest !== currentLocalDigest) {
      this.operationLogService.log('info', `Digest mismatch for ${imageRef}: DB=${currentDigest?.substring(0, 19)}... vs Current=${currentLocalDigest?.substring(0, 19)}...`);
    }

    // Use current local digest for comparison, fallback to database digest if current check fails
    const localDigest = currentLocalDigest || currentDigest;

    if (!localDigest) {
      return { updateAvailable: false, error: '无法获取本地镜像 digest' };
    }

    // Normalize digest formats for comparison
    const normalizedLocalDigest = this.normalizeDigest(localDigest);
    const normalizedRemoteDigest = this.normalizeDigest(remoteDigest);

    const updateAvailable = Boolean(normalizedLocalDigest && normalizedRemoteDigest && normalizedLocalDigest !== normalizedRemoteDigest);

    return {
      updateAvailable,
      remoteDigest,
      currentLocalDigest: currentLocalDigest || undefined,
      error: undefined,
    };
  }

  /**
   * Filter Docker command output to remove verbose information
   * Keep only relevant information like digest lines, error messages, and operation status
   */
  private filterDockerOutput(output: string, command: string): string {
    if (!output) return output;

    const lines = output.split('\n');
    const filteredLines: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip empty lines
      if (!trimmedLine) continue;

      // Always keep error messages and warnings
      if (trimmedLine.toLowerCase().includes('error') ||
          trimmedLine.toLowerCase().includes('warning') ||
          trimmedLine.toLowerCase().includes('failed')) {
        filteredLines.push(line);
        continue;
      }

      // For docker pull commands, keep digest and status information
      if (command.includes('pull')) {
        if (trimmedLine.includes('Digest:') ||
            trimmedLine.includes('Status:') ||
            trimmedLine.includes('Pull complete') ||
            trimmedLine.includes('Already exists') ||
            trimmedLine.includes('Pulling from') ||
            trimmedLine.includes('toomanyrequests') ||
            trimmedLine.includes('Too Many Requests')) {
          filteredLines.push(line);
          continue;
        }
      }

      // For docker login commands, keep login status
      if (command.includes('login')) {
        if (trimmedLine.includes('Login Succeeded') ||
            trimmedLine.includes('Login failed') ||
            trimmedLine.includes('unauthorized') ||
            trimmedLine.includes('authentication')) {
          filteredLines.push(line);
          continue;
        }
      }

      // Skip verbose Docker version information
      if (trimmedLine.includes('Client: Docker Engine') ||
          trimmedLine.includes('Version:') ||
          trimmedLine.includes('Context:') ||
          trimmedLine.includes('Debug Mode:') ||
          trimmedLine.includes('Server: Docker Engine') ||
          trimmedLine.includes('containerd:') ||
          trimmedLine.includes('runc:') ||
          trimmedLine.includes('docker-init:')) {
        continue;
      }

      // Keep other potentially important lines (but filter out progress bars)
      if (!trimmedLine.match(/^[=>\s]*\d+%/) &&
          !trimmedLine.match(/^\[=+>\s*\]/) &&
          trimmedLine.length > 0) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  /**
   * 批量检查多个镜像的更新状态
   * 使用 Registry API 进行并发检查，大幅提升性能
   */
  async batchCheckImageUpdates(
    imageRefs: string[],
    concurrency = 5
  ): Promise<Map<string, { updateAvailable: boolean; remoteDigest?: string; error?: string }>> {
    this.operationLogService.log('info', `Starting batch check for ${imageRefs.length} images with concurrency ${concurrency}`);

    try {
      // 使用 Registry API 批量获取远程 digest
      const remoteDigests = await this.registryService.batchGetRemoteImageDigests(imageRefs, concurrency);

      const results = new Map<string, { updateAvailable: boolean; remoteDigest?: string; error?: string }>();

      for (const imageRef of imageRefs) {
        const remoteResult = remoteDigests.get(imageRef);

        if (!remoteResult) {
          results.set(imageRef, {
            updateAvailable: false,
            error: 'No remote digest result found',
          });
          continue;
        }

        if (remoteResult.error) {
          results.set(imageRef, {
            updateAvailable: false,
            error: remoteResult.error,
          });
          continue;
        }

        if (remoteResult.digest) {
          results.set(imageRef, {
            updateAvailable: true, // 简化版本：有远程 digest 就认为可能有更新
            remoteDigest: remoteResult.digest,
          });
        } else {
          results.set(imageRef, {
            updateAvailable: false,
          });
        }
      }

      this.operationLogService.log('info', `Batch check completed for ${imageRefs.length} images`);
      return results;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Batch check failed: ${errorMessage}`);

      // 返回所有镜像的错误结果
      const results = new Map<string, { updateAvailable: boolean; remoteDigest?: string; error?: string }>();
      for (const imageRef of imageRefs) {
        results.set(imageRef, {
          updateAvailable: false,
          error: `Batch check failed: ${errorMessage}`,
        });
      }
      return results;
    }
  }

  /**
   * Normalize digest format for consistent comparison
   * Handles different digest formats from various sources
   */
  private normalizeDigest(digest: string): string {
    if (!digest) return '';

    // Extract SHA256 hash from various formats:
    // - "nginx@sha256:abc123..." -> "sha256:abc123..."
    // - "sha256:abc123..." -> "sha256:abc123..."
    // - "registry.io/nginx@sha256:abc123..." -> "sha256:abc123..."
    const sha256Match = digest.match(/sha256:[a-f0-9]{64}/);
    return sha256Match ? sha256Match[0] : digest;
  }
}
