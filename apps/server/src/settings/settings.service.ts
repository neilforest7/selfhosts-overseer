import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { z } from 'zod';

const SettingsSchema = z.object({
  sshConcurrency: z.number().int().min(10).max(100).default(30),
  commandTimeoutSeconds: z.number().int().min(10).max(900).default(100),
  containerUpdateCheckCron: z.string().default('45 0 * * *')
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

