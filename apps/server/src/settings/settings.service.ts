import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../security/crypto.service';
import { z } from 'zod';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch from 'node-fetch';

const SettingsSchema = z.object({
  sshConcurrency: z.number().int().min(10).max(100).default(30),
  commandTimeoutSeconds: z.number().int().min(10).max(900).default(100),
  containerUpdateCheckCron: z.string().default('45 0 * * *'),
  // Activity Log 配置
  activityLogRetentionDays: z.number().int().min(1).max(365).default(30),
  activityLogCleanupEnabled: z.boolean().default(true),
  // Docker 代理配置
  dockerProxyEnabled: z.boolean().default(false),
  dockerProxyHost: z.string().optional().default(''),
  dockerProxyPort: z.number().int().min(1).max(65535).default(8080),
  dockerProxyUsername: z.string().optional().default(''),
  dockerProxyPassword: z.string().optional().default(''),
  dockerProxyLocalOnly: z.boolean().default(true),
  // Docker 凭证配置
  dockerCredentialsEnabled: z.boolean().default(false),
  dockerCredentialsUsername: z.string().optional().default(''),
  dockerCredentialsPersonalAccessToken: z.string().optional().default(''),
  // GHCR (GitHub Container Registry) 凭证配置
  ghcrCredentialsEnabled: z.boolean().default(false),
  ghcrUsername: z.string().optional().default(''),
  ghcrPersonalAccessToken: z.string().optional().default(''),
  // 连接性检查配置
  connectivityCheckInterval: z.number().int().min(60).max(3600).default(300), // 5 minutes default
  connectivityCheckTimeout: z.number().int().min(5).max(60).default(10), // 10 seconds default
  connectivityCheckRetries: z.number().int().min(0).max(5).default(1), // 1 retry default
  connectivityAlertThreshold: z.number().int().min(1).max(10).default(3), // Alert after 3 failed checks
  connectivityCheckEnabled: z.boolean().default(true),
  // DNS 解析配置
  dnsResolutionFrequencyMinutes: z.number().int().min(5).max(1440).default(60), // 1 hour default, range: 5 minutes to 24 hours
  dnsSkipNonAddressRecords: z.boolean().default(false), // Skip non-standard records (only resolve A, AAAA, CNAME) during resolution
  // Registry API 配置
  registryApiEnabled: z.boolean().default(true), // 启用 Registry API 检查
  registryApiTimeoutSeconds: z.number().int().min(10).max(120).default(30), // Registry API 请求超时时间
  registryApiRetries: z.number().int().min(1).max(5).default(3), // Registry API 重试次数
  registryApiConcurrency: z.number().int().min(1).max(20).default(5), // 批量检查并发数
  registryApiFallbackEnabled: z.boolean().default(true), // 启用 docker pull 回退机制
  registryApiCacheEnabled: z.boolean().default(true), // 启用 token 缓存
});

export type Settings = z.infer<typeof SettingsSchema>;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  private async readAll(): Promise<Settings> {
    const rows = await this.prisma.appSetting.findMany();
    const map = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
    return SettingsSchema.parse(map);
  }

  private async writeAll(settings: Settings): Promise<void> {
    const entries = Object.entries(settings);
    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.appSetting.upsert({
          where: { key },
          create: { key, value: JSON.stringify(value) },
          update: { value: JSON.stringify(value) }
        })
      )
    );
  }

  async get(): Promise<Settings> {
    // initialize defaults if empty
    const existing = await this.prisma.appSetting.count();
    if (existing === 0) {
      const defaults = SettingsSchema.parse({});
      await this.writeAll(defaults);
      return defaults;
    }
    return this.readAll();
  }

  /**
   * 获取解密后的 GHCR 凭证
   */
  async getDecryptedGhcrCredentials(): Promise<{
    enabled: boolean;
    username: string;
    personalAccessToken: string;
  }> {
    const settings = await this.get();

    return {
      enabled: settings.ghcrCredentialsEnabled,
      username: settings.ghcrUsername || '',
      personalAccessToken: settings.ghcrPersonalAccessToken
        ? (this.crypto.decryptString(settings.ghcrPersonalAccessToken) || '')
        : '',
    };
  }

  /**
   * 设置加密的 GHCR 凭证
   */
  async setGhcrCredentials(credentials: {
    enabled: boolean;
    username: string;
    personalAccessToken: string;
  }): Promise<void> {
    const currentSettings = await this.get();

    const encryptedToken = credentials.personalAccessToken
      ? this.crypto.encryptString(credentials.personalAccessToken)
      : '';

    const updatedSettings = {
      ...currentSettings,
      ghcrCredentialsEnabled: credentials.enabled,
      ghcrUsername: credentials.username,
      ghcrPersonalAccessToken: encryptedToken || '',
    };

    await this.writeAll(updatedSettings);
  }

  /**
   * 测试 GHCR 连接和凭证有效性
   */
  async testGhcrConnectivity(credentials: {
    username: string;
    personalAccessToken: string;
  }): Promise<{
    success: boolean;
    message: string;
    details?: any;
  }> {
    const startTime = Date.now();

    try {
      // 测试 GHCR 认证
      const authUrl = 'https://ghcr.io/token?service=ghcr.io&scope=repository:library/hello-world:pull';

      // 创建基本认证头部
      const auth = Buffer.from(`${credentials.username}:${credentials.personalAccessToken}`).toString('base64');

      const response = await fetch(authUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Basic ${auth}`,
          'User-Agent': 'SelfHost-Serv-Agent/1.0',
        },
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json() as any;

        if (data.token) {
          this.logger.log(`GHCR connectivity test successful for user: ${credentials.username}`);

          return {
            success: true,
            message: `GHCR 连接成功 (${responseTime}ms)`,
            details: {
              username: credentials.username,
              responseTime,
              tokenReceived: true,
            },
          };
        } else {
          return {
            success: false,
            message: 'GHCR 认证失败：未收到有效 token',
            details: {
              username: credentials.username,
              responseTime,
              response: data,
            },
          };
        }
      } else {
        const errorText = await response.text().catch(() => 'Unknown error');

        if (response.status === 401) {
          return {
            success: false,
            message: 'GHCR 认证失败：用户名或 Personal Access Token 无效',
            details: {
              username: credentials.username,
              responseTime,
              status: response.status,
              error: errorText,
            },
          };
        } else if (response.status === 403) {
          return {
            success: false,
            message: 'GHCR 认证失败：Personal Access Token 权限不足，请确保包含 read:packages 权限',
            details: {
              username: credentials.username,
              responseTime,
              status: response.status,
              error: errorText,
            },
          };
        } else {
          return {
            success: false,
            message: `GHCR 连接失败：${response.status} ${response.statusText}`,
            details: {
              username: credentials.username,
              responseTime,
              status: response.status,
              error: errorText,
            },
          };
        }
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`GHCR connectivity test failed: ${errorMessage}`);

      // 分析错误类型并提供更友好的错误信息
      let friendlyMessage = 'GHCR 连接失败';

      if (errorMessage.includes('ENOTFOUND')) {
        friendlyMessage = '无法解析 ghcr.io 域名，请检查网络连接';
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
        friendlyMessage = '连接 GHCR 超时，请检查网络连接或代理设置';
      } else if (errorMessage.includes('ECONNREFUSED')) {
        friendlyMessage = 'GHCR 服务器拒绝连接';
      } else {
        friendlyMessage = `GHCR 连接错误: ${errorMessage}`;
      }

      return {
        success: false,
        message: friendlyMessage,
        details: {
          username: credentials.username,
          responseTime,
          error: errorMessage,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        },
      };
    }
  }

  async update(partial: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const merged = SettingsSchema.parse({ ...current, ...partial });
    await this.writeAll(merged);

    // Note: DNS processor will check for updated settings on its next scheduled run
    // This avoids circular dependencies while still allowing settings to take effect

    return merged;
  }

  async testDockerHubConnectivity(config: {
    proxyHost: string;
    proxyPort: number;
    proxyUsername?: string;
    proxyPassword?: string;
  }): Promise<{ success: boolean; message: string; details?: any }> {
    const startTime = Date.now();

    try {
      this.logger.log(`Testing Docker Hub connectivity through proxy ${config.proxyHost}:${config.proxyPort}`);

      // 构建代理 URL
      let proxyUrl = `http://`;
      if (config.proxyUsername && config.proxyPassword) {
        proxyUrl += `${encodeURIComponent(config.proxyUsername)}:${encodeURIComponent(config.proxyPassword)}@`;
      }
      proxyUrl += `${config.proxyHost}:${config.proxyPort}`;

      // 创建代理 agent
      const agent = new HttpsProxyAgent(proxyUrl);

      // 测试 Docker Hub API 连接
      const dockerHubApiUrl = 'https://registry-1.docker.io/v2/';

      const response = await fetch(dockerHubApiUrl, {
        method: 'GET',
        agent,
        timeout: 10000, // 10 seconds timeout
        headers: {
          'User-Agent': 'SelfHost-Serv-Agent/1.0',
        },
      });

      const responseTime = Date.now() - startTime;

      if (response.ok || response.status === 401) {
        // 401 is expected for Docker Hub API without authentication
        // This means we successfully reached Docker Hub through the proxy
        this.logger.log(`Docker Hub connectivity test successful (${responseTime}ms)`);

        return {
          success: true,
          message: `Docker Hub 连接成功 (响应时间: ${responseTime}ms)`,
          details: {
            proxyHost: config.proxyHost,
            proxyPort: config.proxyPort,
            responseTime,
            statusCode: response.status,
            statusText: response.statusText,
          },
        };
      } else {
        this.logger.warn(`Docker Hub connectivity test failed with status ${response.status}`);

        return {
          success: false,
          message: `Docker Hub 连接失败: HTTP ${response.status} ${response.statusText}`,
          details: {
            proxyHost: config.proxyHost,
            proxyPort: config.proxyPort,
            responseTime,
            statusCode: response.status,
            statusText: response.statusText,
          },
        };
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`Docker Hub connectivity test failed: ${errorMessage}`);

      // 分析错误类型并提供更友好的错误信息
      let friendlyMessage = '连接失败';

      if (errorMessage.includes('ECONNREFUSED')) {
        friendlyMessage = '代理服务器拒绝连接，请检查代理地址和端口是否正确';
      } else if (errorMessage.includes('ENOTFOUND')) {
        friendlyMessage = '无法解析代理服务器地址，请检查代理主机名是否正确';
      } else if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
        friendlyMessage = '连接超时，请检查代理服务器是否可达或网络连接';
      } else if (errorMessage.includes('407')) {
        friendlyMessage = '代理服务器需要身份验证，请检查用户名和密码';
      } else if (errorMessage.includes('ECONNRESET')) {
        friendlyMessage = '连接被重置，可能是代理服务器配置问题';
      } else {
        friendlyMessage = `连接错误: ${errorMessage}`;
      }

      return {
        success: false,
        message: friendlyMessage,
        details: {
          proxyHost: config.proxyHost,
          proxyPort: config.proxyPort,
          responseTime,
          error: errorMessage,
          errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        },
      };
    }
  }
}

