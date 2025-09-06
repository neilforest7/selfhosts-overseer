import { Injectable, Logger } from '@nestjs/common';
import { OperationLogService } from '../operation-log/operation-log.service';
import { SettingsService } from '../settings/settings.service';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch, { RequestInit as NodeRequestInit, Response as NodeResponse } from 'node-fetch';

export interface RegistryAuthToken {
  token: string;
  expiresAt: Date;
}

export interface RegistryManifest {
  digest: string;
  mediaType: string;
  size: number;
}

export interface RegistryConfig {
  authUrl: string;
  registryUrl: string;
  scope: string;
  service: string;
}

@Injectable()
export class DockerRegistryService {
  private readonly logger = new Logger(DockerRegistryService.name);
  private readonly tokenCache = new Map<string, RegistryAuthToken>();
  
  constructor(
    private readonly operationLogService: OperationLogService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * 验证代理配置的有效性
   */
  private validateProxyConfig(settings: any): void {
    if (!settings.dockerProxyHost) {
      throw new Error('Proxy host is required when proxy is enabled');
    }

    if (!settings.dockerProxyPort || settings.dockerProxyPort < 1 || settings.dockerProxyPort > 65535) {
      throw new Error('Valid proxy port (1-65535) is required');
    }

    // 验证主机名格式
    const hostRegex = /^[a-zA-Z0-9.-]+$/;
    if (!hostRegex.test(settings.dockerProxyHost)) {
      throw new Error('Invalid proxy host format');
    }

    // 如果启用了认证，验证用户名和密码
    if (settings.dockerProxyUsername && !settings.dockerProxyPassword) {
      throw new Error('Proxy password is required when username is provided');
    }

    if (!settings.dockerProxyUsername && settings.dockerProxyPassword) {
      throw new Error('Proxy username is required when password is provided');
    }

    this.operationLogService.log('info', `🔗 Proxy configuration validated: ${settings.dockerProxyHost}:${settings.dockerProxyPort}`);
  }

  /**
   * 创建带有代理和认证配置的 fetch 选项
   */
  private async createFetchOptions(additionalHeaders: Record<string, string> = {}): Promise<any> {
    const settings = await this.settings.get();
    const options: any = {
      headers: {
        'User-Agent': 'SelfHost-Serv-Agent/1.0',
        ...additionalHeaders,
      },
    };

    // 配置代理
    if (settings.dockerProxyEnabled && settings.dockerProxyHost) {
      try {
        // 验证代理配置
        this.validateProxyConfig(settings);

        // 如果有代理认证
        if (settings.dockerProxyUsername && settings.dockerProxyPassword) {
          const proxyUrlWithAuth = `http://${settings.dockerProxyUsername}:${settings.dockerProxyPassword}@${settings.dockerProxyHost}:${settings.dockerProxyPort}`;
          options.agent = new HttpsProxyAgent(proxyUrlWithAuth, {
            keepAlive: true,
            keepAliveMsecs: 30000,
            timeout: 60000,
          });
          this.operationLogService.log('info', `🔐 Using authenticated proxy: ${settings.dockerProxyHost}:${settings.dockerProxyPort} (user: ${settings.dockerProxyUsername})`);
        } else {
          const proxyUrl = `http://${settings.dockerProxyHost}:${settings.dockerProxyPort}`;
          options.agent = new HttpsProxyAgent(proxyUrl, {
            keepAlive: true,
            keepAliveMsecs: 30000,
            timeout: 60000,
          });
          this.operationLogService.log('info', `Using proxy: ${settings.dockerProxyHost}:${settings.dockerProxyPort}`);
        }
      } catch (error) {
        this.operationLogService.log('error', `❌ Proxy configuration error: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
    } else {
      this.operationLogService.log('info', `Direct connection (proxy disabled or not configured)`);
    }

    return options;
  }

  /**
   * 带超时的 fetch 请求，包含详细的网络诊断
   */
  private async fetchWithTimeout(url: string, options: any, timeoutMs: number): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const startTime = Date.now();

    try {
      this.operationLogService.log('info', `Starting request to ${url} with timeout ${timeoutMs}ms`);

      // 记录代理配置
      if (options.agent) {
        this.operationLogService.log('info', `Using proxy agent for request`);
      } else {
        this.operationLogService.log('info', `Direct connection (no proxy)`);
      }

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;
      this.operationLogService.log('info', `Request completed in ${duration}ms, status: ${response.status}`);

      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      if (error instanceof Error && error.name === 'AbortError') {
        this.operationLogService.log('error', `⏰ Request timeout after ${duration}ms (limit: ${timeoutMs}ms) to ${url}`);
        throw new Error(`Request timeout after ${timeoutMs}ms to ${url}`);
      }

      // 详细的网络错误分析
      this.analyzeNetworkError(error, url, duration, options.agent ? 'proxy' : 'direct');
      throw error;
    }
  }

  /**
   * 分析网络错误并提供详细诊断信息
   */
  private analyzeNetworkError(error: any, url: string, duration: number, connectionType: string): void {
    const errorInfo = {
      url,
      duration: `${duration}ms`,
      connectionType,
      errorName: error?.name || 'Unknown',
      errorCode: error?.code || 'Unknown',
      errorMessage: error?.message || 'Unknown error',
    };

    this.operationLogService.log('error', `❌ Network error details: ${JSON.stringify(errorInfo, null, 2)}`);

    // 特定错误类型的诊断
    if (error?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      this.operationLogService.log('error', `❌ Connection timeout detected. This may indicate:`);
      this.operationLogService.log('error', `   - Proxy server is not responding`);
      this.operationLogService.log('error', `   - Target server is unreachable through proxy`);
      this.operationLogService.log('error', `   - Network latency is higher than timeout setting`);
      this.operationLogService.log('error', `   - Firewall blocking the connection`);
    } else if (error?.code === 'ENOTFOUND') {
      this.operationLogService.log('error', `❌ DNS resolution failed. Check:`);
      this.operationLogService.log('error', `   - DNS server configuration`);
      this.operationLogService.log('error', `   - Network connectivity`);
      this.operationLogService.log('error', `   - Domain name spelling`);
    } else if (error?.code === 'ECONNREFUSED') {
      this.operationLogService.log('error', `❌ Connection refused. Check:`);
      this.operationLogService.log('error', `   - Target server is running`);
      this.operationLogService.log('error', `   - Port is correct and open`);
      this.operationLogService.log('error', `   - Firewall rules`);
    }
  }

  /**
   * 添加仓库认证头部（支持 Docker Hub 和 GHCR）
   */
  private async addRegistryAuth(headers: Record<string, string>, config: RegistryConfig): Promise<Record<string, string>> {
    const settings = await this.settings.get();

    // Docker Hub 认证
    if (config.service === 'registry.docker.io' && settings.dockerCredentialsEnabled) {
      if (settings.dockerCredentialsUsername && settings.dockerCredentialsPersonalAccessToken) {
        const auth = Buffer.from(`${settings.dockerCredentialsUsername}:${settings.dockerCredentialsPersonalAccessToken}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
        this.operationLogService.log('info', `Using Docker Hub authentication for user: ${settings.dockerCredentialsUsername}`);
      }
    }

    // GHCR 认证
    if (config.service === 'ghcr.io') {
      const ghcrCredentials = await this.settings.getDecryptedGhcrCredentials();

      if (ghcrCredentials.enabled && ghcrCredentials.username && ghcrCredentials.personalAccessToken) {
        const auth = Buffer.from(`${ghcrCredentials.username}:${ghcrCredentials.personalAccessToken}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
        this.operationLogService.log('info', `Using GHCR authentication for user: ${ghcrCredentials.username}`);
      }
    }

    return headers;
  }

  /**
   * 检测镜像仓库类型并返回相应的配置
   */
  private getRegistryConfig(imageRef: string): RegistryConfig {
    // 首先分离镜像名称和标签，避免标签中的点号干扰仓库检测
    const [fullImageName] = imageRef.split(':');

    // GitHub Container Registry (GHCR)
    if (fullImageName.startsWith('ghcr.io/')) {
      const imageName = fullImageName.replace('ghcr.io/', '');
      return {
        authUrl: 'https://ghcr.io/token',
        registryUrl: 'https://ghcr.io/v2',
        scope: `repository:${imageName}:pull`,
        service: 'ghcr.io',
      };
    }

    // Quay.io
    if (fullImageName.startsWith('quay.io/')) {
      const imageName = fullImageName.replace('quay.io/', '');
      return {
        authUrl: 'https://quay.io/v2/auth',
        registryUrl: 'https://quay.io/v2',
        scope: `repository:${imageName}:pull`,
        service: 'quay.io',
      };
    }

    // Docker Hub 官方镜像 (nginx, ubuntu 等) - 没有斜杠或以 library/ 开头
    if (!fullImageName.includes('/') || fullImageName.startsWith('library/')) {
      const imageName = fullImageName.startsWith('library/') ? fullImageName.replace('library/', '') : fullImageName;
      return {
        authUrl: 'https://auth.docker.io/token',
        registryUrl: 'https://registry-1.docker.io/v2',
        scope: `repository:library/${imageName}:pull`,
        service: 'registry.docker.io',
      };
    }

    // 显式的 Docker Hub 镜像 (docker.io/user/image)
    if (fullImageName.startsWith('docker.io/')) {
      const imageName = fullImageName.replace('docker.io/', '');
      return {
        authUrl: 'https://auth.docker.io/token',
        registryUrl: 'https://registry-1.docker.io/v2',
        scope: `repository:${imageName}:pull`,
        service: 'registry.docker.io',
      };
    }

    // 检查是否为私有仓库：只有当第一部分包含点号且看起来像域名时才认为是私有仓库
    const parts = fullImageName.split('/');
    const firstPart = parts[0];

    // 私有仓库检测条件：
    // 1. 第一部分包含点号
    // 2. 不是单纯的用户名（用户名通常不包含点号）
    // 3. 看起来像域名（包含 TLD 或 IP 地址）
    const isPrivateRegistry = firstPart.includes('.') && (
      // 包含常见 TLD
      /\.(com|org|net|io|dev|local|internal)$/i.test(firstPart) ||
      // 或者是 IP 地址格式
      /^\d+\.\d+\.\d+\.\d+$/.test(firstPart) ||
      // 或者包含端口号
      /:\d+$/.test(firstPart)
    );

    if (isPrivateRegistry && parts.length > 1) {
      const registryHost = firstPart;
      const imageName = parts.slice(1).join('/');

      this.operationLogService.log('info', `🔍 Detected private registry: ${registryHost} for image: ${imageName}`);

      return {
        authUrl: `https://${registryHost}/v2/auth`,
        registryUrl: `https://${registryHost}/v2`,
        scope: `repository:${imageName}:pull`,
        service: registryHost,
      };
    }

    // Docker Hub 用户镜像 (user/image) - 默认情况
    // 如果不是私有仓库但包含斜杠，则认为是 Docker Hub 用户镜像
    if (fullImageName.includes('/')) {
      this.operationLogService.log('info', `🔍 Detected Docker Hub user image: ${fullImageName}`);

      return {
        authUrl: 'https://auth.docker.io/token',
        registryUrl: 'https://registry-1.docker.io/v2',
        scope: `repository:${fullImageName}:pull`,
        service: 'registry.docker.io',
      };
    }

    // 最终回退到 Docker Hub 官方镜像
    this.operationLogService.log('info', `🔍 Fallback to Docker Hub official image: ${fullImageName}`);

    return {
      authUrl: 'https://auth.docker.io/token',
      registryUrl: 'https://registry-1.docker.io/v2',
      scope: `repository:library/${fullImageName}:pull`,
      service: 'registry.docker.io',
    };
  }

  /**
   * 获取认证 token
   */
  private async getAuthToken(config: RegistryConfig): Promise<string> {
    const cacheKey = `${config.authUrl}:${config.scope}`;
    const cached = this.tokenCache.get(cacheKey);

    // 检查缓存的 token 是否仍然有效（提前 5 分钟过期）
    const settings = await this.settings.get();
    if (settings.registryApiCacheEnabled && cached && cached.expiresAt > new Date(Date.now() + 5 * 60 * 1000)) {
      return cached.token;
    }

    try {
      const url = `${config.authUrl}?service=${encodeURIComponent(config.service)}&scope=${encodeURIComponent(config.scope)}`;

      // 创建基础头部
      let headers: Record<string, string> = {
        'Accept': 'application/json',
      };

      // 添加仓库认证（如果配置了）
      headers = await this.addRegistryAuth(headers, config);

      // 创建 fetch 选项（包含代理配置）
      const fetchOptions = await this.createFetchOptions(headers);

      // 对于代理环境，使用更长的超时时间
      const timeoutMs = settings.dockerProxyEnabled
        ? Math.max(settings.registryApiTimeoutSeconds * 1000, 60000) // 至少60秒
        : settings.registryApiTimeoutSeconds * 1000;

      this.operationLogService.log('info', `Using timeout: ${timeoutMs}ms (proxy: ${settings.dockerProxyEnabled})`);

      const response = await this.fetchWithTimeout(url, {
        method: 'GET',
        ...fetchOptions,
      }, timeoutMs);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Auth request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      if (!data.token) {
        throw new Error('No token in auth response');
      }

      // 缓存 token（默认 1 小时有效期）
      if (settings.registryApiCacheEnabled) {
        const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
        this.tokenCache.set(cacheKey, {
          token: data.token,
          expiresAt,
        });
      }

      return data.token;
    } catch (error) {
      console.log(error)
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Failed to get auth token for ${config.service}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 获取镜像 manifest 的 digest
   */
  async getRemoteImageDigest(imageRef: string): Promise<{ digest?: string; error?: string; rateLimited?: boolean }> {
    try {
      const settings = await this.settings.get();
      const config = this.getRegistryConfig(imageRef);

      this.operationLogService.log('info', `Getting remote digest for ${imageRef} from ${config.service}`);

      const token = await this.getAuthToken(config);

      // 解析镜像名称和标签
      const [imageName, tag = 'latest'] = imageRef.split(':');
      let cleanImageName = imageName;

      // 清理镜像名称，移除仓库前缀
      if (imageRef.includes('ghcr.io/')) {
        cleanImageName = imageName.replace('ghcr.io/', '');
      } else if (imageRef.includes('quay.io/')) {
        cleanImageName = imageName.replace('quay.io/', '');
      } else if (imageRef.includes('docker.io/')) {
        cleanImageName = imageName.replace('docker.io/', '');
      } else if (!imageRef.includes('/') || imageRef.startsWith('library/')) {
        // Docker Hub 官方镜像
        cleanImageName = `library/${imageName}`;
      }

      // 构建 manifest URL
      const manifestUrl = `${config.registryUrl}/${cleanImageName}/manifests/${tag}`;

      // 创建头部，支持多种 manifest 格式
      const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Accept': [
          'application/vnd.oci.image.index.v1+json',           // OCI 索引格式 (GHCR 常用)
          'application/vnd.oci.image.manifest.v1+json',        // OCI manifest 格式
          'application/vnd.docker.distribution.manifest.list.v2+json', // Docker manifest 列表
          'application/vnd.docker.distribution.manifest.v2+json',      // Docker manifest v2
          'application/vnd.docker.distribution.manifest.v1+json',      // Docker manifest v1 (兼容)
        ].join(', '),
      };

      // 创建 fetch 选项（包含代理配置）
      const fetchOptions = await this.createFetchOptions(headers);

      // 对于代理环境，使用更长的超时时间
      const timeoutMs = settings.dockerProxyEnabled
        ? Math.max(settings.registryApiTimeoutSeconds * 1000, 60000) // 至少60秒
        : settings.registryApiTimeoutSeconds * 1000;

      this.operationLogService.log('info', `Manifest request timeout: ${timeoutMs}ms (proxy: ${settings.dockerProxyEnabled})`);

      const response = await this.fetchWithTimeout(manifestUrl, {
        method: 'HEAD', // 使用 HEAD 请求只获取 headers
        ...fetchOptions,
      }, timeoutMs);

      if (!response.ok) {
        if (response.status === 429) {
          return { rateLimited: true, error: 'Rate limited by registry' };
        }
        if (response.status === 401) {
          return { error: `Authentication failed for ${config.service}` };
        }
        if (response.status === 403) {
          // 特别处理 GHCR 的权限问题
          if (config.service === 'ghcr.io') {
            return { error: `Access denied for GHCR image: ${imageRef}. This may be a private repository requiring GitHub authentication.` };
          }
          return { error: `Access denied for ${imageRef}` };
        }
        if (response.status === 404) {
          // 检查是否是 OCI 格式问题
          const errorText = await response.text().catch(() => '');
          if (errorText.includes('OCI index found') || errorText.includes('Accept header does not support')) {
            return { error: `Manifest format not supported. This has been fixed - please try again.` };
          }
          return { error: `Image not found: ${imageRef}` };
        }
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`Manifest request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const digest = response.headers.get('docker-content-digest');
      if (!digest) {
        throw new Error('No digest found in manifest response headers');
      }

      // this.operationLogService.log('info', `✅ Found remote digest for ${imageRef}: ${digest}`);
      return { digest };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `❌ Failed to get remote digest for ${imageRef}: ${errorMessage}`);
      return { error: errorMessage };
    }
  }

  /**
   * 批量获取多个镜像的远程 digest
   */
  async batchGetRemoteImageDigests(imageRefs: string[], concurrency?: number): Promise<Map<string, { digest?: string; error?: string }>> {
    const settings = await this.settings.get();
    const actualConcurrency = concurrency || settings.registryApiConcurrency;

    const results = new Map<string, { digest?: string; error?: string }>();

    // 分批处理以控制并发
    for (let i = 0; i < imageRefs.length; i += actualConcurrency) {
      const batch = imageRefs.slice(i, i + actualConcurrency);
      const promises = batch.map(async (imageRef) => {
        const result = await this.getRemoteImageDigest(imageRef);
        return { imageRef, result };
      });

      const batchResults = await Promise.allSettled(promises);

      for (const promiseResult of batchResults) {
        if (promiseResult.status === 'fulfilled') {
          const { imageRef, result } = promiseResult.value;
          results.set(imageRef, result);
        } else {
          // 处理 Promise 被拒绝的情况
          this.operationLogService.log('error', `Batch digest check failed: ${promiseResult.reason}`);
        }
      }

      // 在批次之间添加短暂延迟以避免速率限制
      if (i + actualConcurrency < imageRefs.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * 清理过期的 token 缓存
   */
  private cleanupTokenCache(): void {
    const now = new Date();
    for (const [key, token] of this.tokenCache.entries()) {
      if (token.expiresAt <= now) {
        this.tokenCache.delete(key);
      }
    }
  }

  /**
   * 带重试机制的远程 digest 获取，针对代理环境优化
   */
  async getRemoteImageDigestWithRetry(
    imageRef: string,
    maxRetries?: number,
    retryDelay = 2000
  ): Promise<{ digest?: string; error?: string; rateLimited?: boolean }> {
    const settings = await this.settings.get();
    const actualMaxRetries = maxRetries || settings.registryApiRetries;
    let lastError: string | undefined;

    // 对于代理环境，使用更长的重试延迟
    const actualRetryDelay = settings.dockerProxyEnabled ? Math.max(retryDelay, 3000) : retryDelay;

    this.operationLogService.log('info', `Starting retry sequence for ${imageRef} (max: ${actualMaxRetries}, delay: ${actualRetryDelay}ms)`);

    for (let attempt = 1; attempt <= actualMaxRetries; attempt++) {
      try {
        this.operationLogService.log('info', `Attempt ${attempt}/${actualMaxRetries} for ${imageRef}`);

        const result = await this.getRemoteImageDigest(imageRef);

        // 如果成功或者是速率限制，直接返回
        if (result.digest || result.rateLimited) {
          this.operationLogService.log('info', `Success on attempt ${attempt}/${actualMaxRetries} for ${imageRef}`);
          return result;
        }

        // 记录错误但继续重试
        lastError = result.error;
        this.operationLogService.log('info', `⚠️ Attempt ${attempt}/${actualMaxRetries} failed for ${imageRef}: ${result.error}`);

        // 如果不是最后一次尝试，等待后重试
        if (attempt < actualMaxRetries) {
          const waitTime = actualRetryDelay * attempt;
          this.operationLogService.log('info', `⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.operationLogService.log('error', `❌ Attempt ${attempt}/${actualMaxRetries} threw error for ${imageRef}: ${lastError}`);

        // 对于网络超时错误，在代理环境下增加额外等待时间
        if (lastError.includes('timeout') && settings.dockerProxyEnabled && attempt < actualMaxRetries) {
          const extraWait = 5000; // 额外等待5秒
          this.operationLogService.log('info', `⏳ Network timeout detected, adding extra wait time: ${extraWait}ms`);
          await new Promise(resolve => setTimeout(resolve, extraWait));
        }

        if (attempt < actualMaxRetries) {
          const waitTime = actualRetryDelay * attempt;
          this.operationLogService.log('info', `⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }

    this.operationLogService.log('error', `❌ All ${actualMaxRetries} attempts failed for ${imageRef}`);
    return { error: lastError || 'All retry attempts failed' };
  }

  /**
   * 检查服务健康状态
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    try {
      // 尝试获取一个简单镜像的 token 来测试服务
      const config = this.getRegistryConfig('nginx:latest');
      await this.getAuthToken(config);

      return {
        healthy: true,
        details: {
          tokenCacheSize: this.tokenCache.size,
          lastTokenCheck: new Date().toISOString(),
          registryUrl: config.registryUrl,
        }
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          error: error instanceof Error ? error.message : String(error),
          tokenCacheSize: this.tokenCache.size,
        }
      };
    }
  }

  /**
   * 获取服务统计信息
   */
  getStats(): {
    tokenCacheSize: number;
    cachedTokens: Array<{ scope: string; expiresAt: string; expiresIn: number }>;
  } {
    const cachedTokens = Array.from(this.tokenCache.entries()).map(([key, token]) => ({
      scope: key.split(':')[1] || key,
      expiresAt: token.expiresAt.toISOString(),
      expiresIn: Math.max(0, Math.floor((token.expiresAt.getTime() - Date.now()) / 1000)),
    }));

    return {
      tokenCacheSize: this.tokenCache.size,
      cachedTokens,
    };
  }

  /**
   * 网络连接诊断工具
   */
  async diagnoseNetworkConnectivity(): Promise<{
    proxyTest: { success: boolean; error?: string; latency?: number };
    directTest: { success: boolean; error?: string; latency?: number };
    dnsTest: { success: boolean; error?: string; resolvedIPs?: string[] };
    recommendations: string[];
  }> {
    const results = {
      proxyTest: { success: false } as { success: boolean; error?: string; latency?: number },
      directTest: { success: false } as { success: boolean; error?: string; latency?: number },
      dnsTest: { success: false } as { success: boolean; error?: string; resolvedIPs?: string[] },
      recommendations: [] as string[],
    };

    const testUrl = 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/nginx:pull';

    // 1. 测试代理连接
    try {
      this.operationLogService.log('info', '🔍 Testing proxy connection...');
      const proxyOptions = await this.createFetchOptions();
      const startTime = Date.now();

      const response = await this.fetchWithTimeout(testUrl, proxyOptions, 30000);
      const latency = Date.now() - startTime;

      results.proxyTest = { success: response.ok, latency };
      this.operationLogService.log('info', `✅ Proxy test completed: ${response.status} in ${latency}ms`);
    } catch (error) {
      results.proxyTest = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      this.operationLogService.log('error', `❌ Proxy test failed: ${results.proxyTest.error}`);
    }

    // 2. 测试直连
    try {
      this.operationLogService.log('info', '🔍 Testing direct connection...');
      const directOptions = { headers: { 'User-Agent': 'SelfHost-Serv-Agent/1.0' } };
      const startTime = Date.now();

      const response = await this.fetchWithTimeout(testUrl, directOptions, 30000);
      const latency = Date.now() - startTime;

      results.directTest = { success: response.ok, latency };
      this.operationLogService.log('info', `✅ Direct test completed: ${response.status} in ${latency}ms`);
    } catch (error) {
      results.directTest = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      this.operationLogService.log('error', `❌ Direct test failed: ${results.directTest.error}`);
    }

    // 3. DNS 解析测试
    try {
      this.operationLogService.log('info', '🔍 Testing DNS resolution...');
      const dns = require('dns').promises;
      const resolvedIPs = await dns.resolve4('auth.docker.io');

      results.dnsTest = { success: true, resolvedIPs };
      this.operationLogService.log('info', `✅ DNS resolution successful: ${resolvedIPs.join(', ')}`);
    } catch (error) {
      results.dnsTest = {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
      this.operationLogService.log('error', `❌ DNS resolution failed: ${results.dnsTest.error}`);
    }

    // 4. 生成建议
    if (!results.proxyTest.success && !results.directTest.success) {
      results.recommendations.push('Both proxy and direct connections failed - check network connectivity');
      results.recommendations.push('Verify internet connection and DNS settings');
    } else if (!results.proxyTest.success && results.directTest.success) {
      results.recommendations.push('Proxy connection failed but direct works - check proxy configuration');
      results.recommendations.push('Verify proxy server is running and accessible');
      results.recommendations.push('Check proxy authentication credentials');
    } else if (results.proxyTest.success && !results.directTest.success) {
      results.recommendations.push('Direct connection failed but proxy works - network may require proxy');
    }

    if (!results.dnsTest.success) {
      results.recommendations.push('DNS resolution failed - check DNS server configuration');
    }

    if (results.proxyTest.latency && results.proxyTest.latency > 10000) {
      results.recommendations.push('Proxy connection is slow - consider increasing timeout settings');
    }

    return results;
  }

  /**
   * 定期清理缓存（可以通过定时任务调用）
   */
  async performMaintenance(): Promise<void> {
    this.cleanupTokenCache();
    this.logger.log(`Token cache cleaned up, current size: ${this.tokenCache.size}`);
  }
}
