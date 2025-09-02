import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { z } from 'zod';

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
  // 连接性检查配置
  connectivityCheckInterval: z.number().int().min(60).max(3600).default(300), // 5 minutes default
  connectivityCheckTimeout: z.number().int().min(5).max(60).default(10), // 10 seconds default
  connectivityCheckRetries: z.number().int().min(0).max(5).default(1), // 1 retry default
  connectivityAlertThreshold: z.number().int().min(1).max(10).default(3), // Alert after 3 failed checks
  connectivityCheckEnabled: z.boolean().default(true)
});

export type Settings = z.infer<typeof SettingsSchema>;

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async update(partial: Partial<Settings>): Promise<Settings> {
    const current = await this.get();
    const merged = SettingsSchema.parse({ ...current, ...partial });
    await this.writeAll(merged);
    return merged;
  }
}

