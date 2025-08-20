import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { SshService, SshExecOptions } from '../ssh/ssh.service';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DockerService {
  constructor(
    private readonly ssh: SshService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * 判断 Docker 命令是否需要网络访问（需要代理）
   */
  private needsNetworkAccess(args: string[]): boolean {
    if (!args.length) return false;
    
    const command = args[0];
    const networkCommands = [
      'pull',           // 拉取镜像
      'push',           // 推送镜像
      'search',         // 搜索镜像
      'login',          // 登录 registry
      'logout'          // 登出 registry
    ];
    
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
  private async ensureDockerLogin(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }): Promise<boolean> {
    try {
      const appSettings = await this.settings.get();
      
      if (!appSettings.dockerCredentialsEnabled || !appSettings.dockerCredentialsUsername || !appSettings.dockerCredentialsPersonalAccessToken) {
        return false;
      }

      // 检查是否已经登录
      const { code: infoCode } = await this.exec(host, ['info'], 30);
      if (infoCode !== 0) {
        console.warn(`[Docker凭证] Docker daemon 不可用: ${host.address}`);
        return false;
      }

      // 尝试登录 Docker Hub
      const loginCmd = `echo "${appSettings.dockerCredentialsPersonalAccessToken}" | docker login --username "${appSettings.dockerCredentialsUsername}" --password-stdin`;
      const { code: loginCode, stderr: loginStderr } = await this.execShell(host, loginCmd, { timeoutSec: 60 });
      
      if (loginCode === 0) {
        console.log(`[Docker凭证] 登录成功: ${host.address}`);
        return true;
      } else {
        console.warn(`[Docker凭证] 登录失败: ${host.address} - ${loginStderr}`);
        return false;
      }
    } catch (error) {
      console.warn(`[Docker凭证] 登录过程出错: ${host.address} - ${error instanceof Error ? error.message : String(error)}`);
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
            where: { address: hostAddress }
          });
          
          // 如果找不到主机信息或主机标签不包含 "local"，则不应用代理
          if (!host || !host.tags || !host.tags.some((tag: string) => tag.toLowerCase().includes('local'))) {
            return '';
          }
        } catch (dbError) {
          console.warn('Failed to query host information for proxy filtering:', dbError);
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
        `NO_PROXY="localhost,127.0.0.1,::1"`
      ];

      return envVars.join(' ');
    } catch (error) {
      console.warn('Failed to build proxy environment variables:', error);
      return '';
    }
  }

  async execShell(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, shellCommand: string, options: SshExecOptions = {}): Promise<{ code: number; stdout: string | Buffer; stderr: string | Buffer; cmd: string }> {
    const isLocal = host.address === '127.0.0.1' || host.address === 'localhost';
    const timeoutSec = options.timeoutSec || 60;
    const encoding = options.encoding || 'utf8';

    if (isLocal) {
      return new Promise((resolve) => {
        const p = spawn('sh', ['-c', shellCommand]);
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutSec * 1000);
        
        p.stdout.on('data', (d) => stdoutChunks.push(d));
        p.stderr.on('data', (d) => stderrChunks.push(d));

        p.on('exit', (code) => { 
          clearTimeout(timer);
          const stdout = encoding === 'utf8' ? Buffer.concat(stdoutChunks).toString('utf8') : Buffer.concat(stdoutChunks);
          const stderr = encoding === 'utf8' ? Buffer.concat(stderrChunks).toString('utf8') : Buffer.concat(stderrChunks);
          resolve({ code: code ?? 1, stdout, stderr, cmd: shellCommand }); 
        });
        p.on('error', (err) => { 
          clearTimeout(timer);
          const stderr = Buffer.from(err.message);
          resolve({ code: 1, stdout: Buffer.alloc(0), stderr: encoding === 'utf8' ? stderr.toString('utf8') : stderr, cmd: shellCommand }); 
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
      hostKeyCheckingMode: 'yes',
      password: host.password,
      privateKey: host.privateKey,
      privateKeyPassphrase: host.privateKeyPassphrase,
      encoding,
    });
    const cmd = `ssh ${host.sshUser}@${host.address} -- ${shellCommand}`;
    return { code: res.code, stdout: res.stdout, stderr: res.stderr, cmd };
  }

  async exec(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, args: string[], timeoutSec = 60): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    const isLocal = host.address === '127.0.0.1' || host.address === 'localhost';
    
    // 对于需要网络访问的命令，优先使用 Docker 凭证
    if (this.needsNetworkAccess(args)) {
      await this.ensureDockerLogin(host);
    }
    
    // 构建代理环境变量
    const proxyEnv = await this.buildProxyEnv(host.address, args);
    const envPrefix = proxyEnv ? `${proxyEnv} ` : '';
    
    const dockerCmd = `${envPrefix}docker ${args.join(' ')}`;
    const escaped = dockerCmd.replace(/'/g, "'\"'\"'");
    const wrapped = `sh -lc '${escaped}'`;
    if (isLocal) {
      // 本机也走统一的 shell 包裹，避免 format/转义差异
      return new Promise((resolve) => {
        const p = spawn('sh', ['-lc', dockerCmd]);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutSec * 1000);
        p.stdout.setEncoding('utf8');
        p.stderr.setEncoding('utf8');
        p.stdout.on('data', (d) => (stdout += d));
        p.stderr.on('data', (d) => (stderr += d));
        p.on('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr, cmd: `sh -lc '${escaped}'` }); });
        p.on('error', () => { clearTimeout(timer); resolve({ code: 1, stdout, stderr, cmd: `sh -lc '${escaped}'` }); });
      });
    }
    const res = await this.ssh.executeCapture({
      host: host.address,
      user: host.sshUser,
      port: host.port,
      command: wrapped,
      connectTimeoutSeconds: Math.min(30, Math.max(5, Math.floor(timeoutSec / 2))),
      killAfterSeconds: timeoutSec,
      hostKeyCheckingMode: 'yes',
      password: host.password,
      privateKey: host.privateKey,
      privateKeyPassphrase: host.privateKeyPassphrase
    });
    const cmd = `ssh -o StrictHostKeyChecking=yes ${host.sshUser}@${host.address} -- ${wrapped}`;
    return { code: res.code, stdout: res.stdout.toString(), stderr: res.stderr.toString(), cmd };
  }

  // 带重试机制的执行方法，用于处理网络连接错误
  async execWithRetry(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, args: string[], timeoutSec = 60, maxRetries = 3): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
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
      'unable to reach registry'
    ];
    
    const lowerStderr = stderr.toLowerCase();
    return networkErrorPatterns.some(pattern => lowerStderr.includes(pattern));
  }

  async inspectImageRepoDigests(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<string[]> {
    const { code, stdout } = await this.exec(host, ['inspect', '--format', '{{json .RepoDigests}}', imageRef], 60);
    if (code !== 0) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async inspectImageRepoTags(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<string[]> {
    const { code, stdout } = await this.exec(host, ['inspect', '--format', '{{json .RepoTags}}', imageRef], 60);
    if (code !== 0) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async resolveImageNameTag(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<{ imageName?: string; imageTag?: string }> {
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

  async psByComposeProject(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, project: string, timeoutSec = 60): Promise<any[]> {
    const { code, stdout } = await this.exec(host, ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, `--format='{{json .}}'`], timeoutSec);
    if (code !== 0) return [];
    const lines = stdout.split('\n').filter(Boolean);
    const items: any[] = [];
    for (const line of lines) {
      try { items.push(JSON.parse(line)); } catch {}
    }
    return items;
  }

  async composeLs(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, timeoutSec = 60): Promise<Array<{ Name?: string; Status?: string; Running?: number; Stopped?: number; WorkingDir?: string }>> {
    const { code, stdout } = await this.exec(host, ['compose', 'ls', '--format', 'json'], timeoutSec);
    if (code !== 0) return [];
    const text = stdout.trim();
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed as any[];
      // some versions output one JSON per line
      const lines = text.split('\n').filter(Boolean);
      const arr: any[] = [];
      for (const line of lines) { try { arr.push(JSON.parse(line)); } catch {} }
      return arr;
    } catch {
      // fallback: try parse table (Name\tStatus...)
      const lines = text.split('\n').filter(Boolean);
      const arr: any[] = [];
      for (const line of lines.slice(1)) {
        const cols = line.trim().split(/\s{2,}/);
        if (cols.length >= 2) arr.push({ Name: cols[0], Status: cols[1] });
      }
      return arr;
    }
  }

  async inspectContainers(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, containerIds: string[], timeoutSec = 120): Promise<any[]> {
    if (!containerIds.length) return [];
    const results: any[] = [];
    for (const id of containerIds) {
      const res = await this.exec(host, ['inspect', id], timeoutSec);
      if (res.code !== 0) continue;
      try {
        const parsed = JSON.parse(res.stdout.trim());
        if (Array.isArray(parsed) && parsed[0]) results.push(parsed[0]);
        else if (parsed) results.push(parsed);
      } catch {
        // ignore this id
      }
    }
    return results;
  }

  async pullImage(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<number> {
    const { code } = await this.exec(host, ['pull', imageRef], 300);
    return code;
  }

  // 获取远程镜像的 manifest 信息，用于检查更新而不实际拉取镜像
  async inspectRemoteManifest(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, imageRef: string, platform?: { architecture?: string; os?: string }): Promise<{ digest?: string; manifestDigest?: string; error?: string; rateLimited?: boolean }> {
    // 检查是否需要 Docker Hub 认证
    const needsAuth = this.isDockerHubImage(imageRef);
    
    // 如果是 Docker Hub 镜像且可能遇到速率限制，尝试使用认证
    if (needsAuth) {
      const authResult = await this.ensureDockerAuth(host);
      if (!authResult.success) {
        // 如果认证失败，记录警告但继续尝试
        console.warn(`Docker Hub 认证失败: ${authResult.error}`);
      }
    }
    
    // 尝试使用 docker manifest inspect 获取远程镜像信息，带重试机制
    const { code, stdout, stderr } = await this.execWithRetry(host, ['manifest', 'inspect', imageRef], 90, 3);
    
    if (code === 0) {
      try {
        const manifest = JSON.parse(stdout.trim());
        
        // 对于 manifest list (multi-arch)
        if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
          // 如果提供了平台信息，尝试匹配对应平台的 manifest
          if (platform && (platform.architecture || platform.os)) {
            const targetArch = platform.architecture || 'amd64';
            const targetOS = platform.os || 'linux';
            
            // 查找匹配的平台
            const matchedManifest = manifest.manifests.find((m: any) => {
              const p = m.platform || {};
              return (p.architecture === targetArch || (!p.architecture && targetArch === 'amd64')) &&
                     (p.os === targetOS || (!p.os && targetOS === 'linux'));
            });
            
            if (matchedManifest) {
    return {
                digest: matchedManifest.digest,
                manifestDigest: matchedManifest.digest 
              };
            }
            
            // 如果没有找到精确匹配，记录警告并使用第一个已知平台的 manifest
            const knownPlatformManifest = manifest.manifests.find((m: any) => {
              const p = m.platform || {};
              return p.architecture && p.architecture !== 'unknown' && p.os && p.os !== 'unknown';
            });
            
            if (knownPlatformManifest) {
              return { 
                digest: knownPlatformManifest.digest,
                manifestDigest: knownPlatformManifest.digest 
              };
            }
          }
          
          // 默认使用第一个 manifest
          return { 
            digest: manifest.manifests[0].digest,
            manifestDigest: manifest.manifests[0].digest 
          };
        }
        
        // 对于单个 manifest
        if (manifest.config && manifest.config.digest) {
          return { 
            digest: manifest.config.digest,
            manifestDigest: manifest.config.digest 
          };
        }
        
        // 如果有 mediaType 和 config，这是一个有效的 manifest
        if (manifest.mediaType && manifest.config) {
          if (manifest.config.digest) {
            return { 
              digest: manifest.config.digest,
              manifestDigest: manifest.config.digest 
            };
          }
        }
      } catch (error) {
        return { error: `解析 manifest 失败: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    // 检查是否是速率限制错误
    const isRateLimited = stderr.includes('toomanyrequests') || stderr.includes('Too Many Requests');
    
    // 如果遇到速率限制且是 Docker Hub 镜像，尝试使用镜像加速器
    if (isRateLimited && this.isDockerHubImage(imageRef)) {
      const mirrorResult = await this.tryMirrorRegistries(host, imageRef, platform);
      if (!mirrorResult.error) {
        return mirrorResult;
      }
    }

    // 如果 manifest inspect 失败，回退到使用 buildx imagetools inspect
    // 先尝试带 --raw 标志（新版本Docker支持），使用重试机制
    let { code: code2, stdout: stdout2, stderr: stderr2 } = await this.execWithRetry(host, ['buildx', 'imagetools', 'inspect', imageRef, '--raw'], 90, 2);
    
    // 如果 --raw 标志不被支持，尝试不带 --raw 标志
    if (code2 !== 0 && stderr2.includes('unknown flag: --raw')) {
      const result = await this.execWithRetry(host, ['buildx', 'imagetools', 'inspect', imageRef], 90, 2);
      code2 = result.code;
      stdout2 = result.stdout;
      stderr2 = result.stderr;
    }
    
    if (code2 === 0) {
      try {
        const manifest = JSON.parse(stdout2.trim());
        // 处理不同格式的输出
        if (manifest.config && manifest.config.digest) {
          return { digest: manifest.config.digest };
        }
        // 如果是 manifest list，取第一个
        if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
          return { digest: manifest.manifests[0].digest };
        }
        // 如果直接包含 digest
        if (manifest.digest) {
          return { digest: manifest.digest };
        }
      } catch (error) {
        return { error: `解析 buildx manifest 失败: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    // buildx 也可能遇到速率限制，再次尝试镜像加速器
    const isRateLimited2 = stderr2.includes('toomanyrequests') || stderr2.includes('Too Many Requests');
    if (isRateLimited2 && this.isDockerHubImage(imageRef)) {
      const mirrorResult = await this.tryMirrorRegistries(host, imageRef, platform);
      if (!mirrorResult.error) {
        return mirrorResult;
      }
    }

    // 最后回退：使用 skopeo（如果可用）
    const { code: code3, stdout: stdout3 } = await this.exec(host, ['run', '--rm', 'quay.io/skopeo/stable', 'inspect', `docker://${imageRef}`], 120);
    
    if (code3 === 0) {
      try {
        const info = JSON.parse(stdout3.trim());
        if (info.Digest) {
          return { digest: info.Digest };
        }
      } catch (error) {
        return { error: `解析 skopeo 输出失败: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    return { 
      error: `无法获取远程镜像信息: manifest inspect 失败 (${stderr.trim()}), buildx imagetools 失败 (${stderr2.trim()}), skopeo 失败`,
      rateLimited: isRateLimited || isRateLimited2
    };
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

  // 确保 Docker Hub 认证
  private async ensureDockerAuth(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }): Promise<{ success: boolean; error?: string }> {
    try {
      // 检查是否已经登录
      const { code: loginCheckCode } = await this.exec(host, ['info'], 30);
      if (loginCheckCode !== 0) {
        return { success: false, error: 'Docker daemon 不可用' };
      }

      // 使用配置的 Docker 凭证进行登录
      const appSettings = await this.settings.get();
      
      if (appSettings.dockerCredentialsEnabled && appSettings.dockerCredentialsUsername && appSettings.dockerCredentialsPersonalAccessToken) {
        // 尝试使用配置的凭证登录
        const loginCmd = `echo "${appSettings.dockerCredentialsPersonalAccessToken}" | docker login --username "${appSettings.dockerCredentialsUsername}" --password-stdin`;
        const { code: loginCode, stderr: loginStderr } = await this.execShell(host, loginCmd, 30);
        
        if (loginCode === 0) {
          return { success: true };
        } else {
          return { success: false, error: `Docker Hub 登录失败: ${loginStderr}` };
        }
      }

      // 如果没有配置凭据，返回失败但不是错误
      return { success: false, error: '未配置 Docker Hub 凭据' };

    } catch (error) {
      return { success: false, error: `Docker 认证过程出错: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // 使用镜像加速器（中国镜像源）
  private async tryMirrorRegistries(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, imageRef: string, platform?: { architecture?: string; os?: string }): Promise<{ digest?: string; manifestDigest?: string; error?: string }> {
    // 常用的 Docker 镜像加速器
    const mirrors = [
      'docker.m.daocloud.io',           // DaoCloud
      'dockerproxy.com',                // Docker Proxy
      'docker.nju.edu.cn',              // 南京大学
      'docker.mirrors.ustc.edu.cn',     // 中科大
    ];

    for (const mirror of mirrors) {
      try {
        // 只对 Docker Hub 镜像使用加速器
        if (!this.isDockerHubImage(imageRef)) {
          continue;
        }

        // 构造镜像加速器URL
        let mirrorImageRef = imageRef;
        if (!imageRef.includes('/')) {
          // 官方镜像需要添加 library/ 前缀
          mirrorImageRef = `${mirror}/library/${imageRef}`;
        } else if (!imageRef.includes('.')) {
          // 用户镜像直接添加镜像源前缀
          mirrorImageRef = `${mirror}/${imageRef}`;
        }

        const { code, stdout, stderr } = await this.exec(host, ['manifest', 'inspect', mirrorImageRef], 30);
        
        if (code === 0) {
          try {
            const manifest = JSON.parse(stdout.trim());
            
            // 处理多架构镜像
            if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
              if (platform && (platform.architecture || platform.os)) {
                const targetArch = platform.architecture || 'amd64';
                const targetOS = platform.os || 'linux';
                
                const matchedManifest = manifest.manifests.find((m: any) => {
                  const p = m.platform || {};
                  return (p.architecture === targetArch || (!p.architecture && targetArch === 'amd64')) &&
                         (p.os === targetOS || (!p.os && targetOS === 'linux'));
                });
                
                if (matchedManifest) {
                  return { 
                    digest: matchedManifest.digest,
                    manifestDigest: matchedManifest.digest 
                  };
                }
              }
              
              return { 
                digest: manifest.manifests[0].digest,
                manifestDigest: manifest.manifests[0].digest 
              };
            }
            
            // 单架构镜像
            if (manifest.config && manifest.config.digest) {
              return { 
                digest: manifest.config.digest,
                manifestDigest: manifest.config.digest 
              };
            }
          } catch (parseError) {
            continue; // 尝试下一个镜像源
          }
        }
      } catch (error) {
        continue; // 尝试下一个镜像源
      }
    }

    return { error: '所有镜像加速器均无法访问' };
  }

  // 获取容器的平台信息
  async getContainerPlatform(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, containerId: string): Promise<{ architecture?: string; os?: string; error?: string }> {
    try {
      // 首先尝试从容器inspect中获取镜像ID，然后检查镜像平台
      const { code, stdout } = await this.exec(host, ['inspect', '--format', '{{.Image}}', containerId], 30);
      if (code !== 0) {
        return { error: '无法获取容器镜像ID' };
      }
      
      const imageId = stdout.trim();
      if (!imageId) {
        return { error: '容器镜像ID为空' };
      }

      // 检查镜像的平台信息
      const { code: code2, stdout: stdout2 } = await this.exec(host, ['inspect', '--format', '{{.Architecture}} {{.Os}}', imageId], 30);
      if (code2 === 0 && stdout2.trim()) {
        const parts = stdout2.trim().split(' ');
        if (parts.length >= 2) {
          return {
            architecture: parts[0] || 'amd64',
            os: parts[1] || 'linux'
          };
        }
      }

      // 如果上面的方法失败，尝试从系统信息推断（通常容器运行在宿主机同架构上）
      const { code: code3, stdout: stdout3 } = await this.exec(host, ['version', '--format', '{{.Server.Arch}}'], 30);
      if (code3 === 0 && stdout3.trim()) {
        return {
          architecture: stdout3.trim(),
          os: 'linux' // Docker 主要运行在 Linux 上
        };
      }

      // 默认假设为最常见的平台
      return {
        architecture: 'amd64',
        os: 'linux'
      };

    } catch (error) {
      return { error: `获取平台信息失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // 获取容器实际运行的镜像 digest（从 docker inspect 的 Image 字段）
  async getContainerImageDigest(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, containerId: string): Promise<string | null> {
    try {
      const { code, stdout } = await this.exec(host, ['inspect', '--format', '{{.Image}}', containerId], 30);
      if (code === 0 && stdout.trim()) {
        const imageId = stdout.trim();
        // 检查是否已经是 digest 格式 (sha256:...)
        if (imageId.startsWith('sha256:')) {
          return imageId;
        }
        
        // 如果是短ID，尝试获取完整的digest
        const { code: code2, stdout: stdout2 } = await this.exec(host, ['inspect', '--format', '{{index .RepoDigests 0}}', imageId], 30);
        if (code2 === 0 && stdout2.trim()) {
          // 提取 digest 部分（格式通常是 "registry/image@sha256:..."）
          const repoDigest = stdout2.trim();
          const digestMatch = repoDigest.match(/@(sha256:[a-f0-9]+)/);
          if (digestMatch) {
            return digestMatch[1];
          }
        }
        
        // 如果还是无法获取，返回 Image ID（可能是 sha256:xxx 格式）
        return imageId;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}

