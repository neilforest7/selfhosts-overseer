import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  [x: string]: any;
  constructor() {
    const url =
      process.env.DATABASE_URL ||
      'postgresql://selfhost:secret@localhost:5432/selfhost?schema=public';

    // 记录数据库 URL 来源用于调试
    console.log(`📍 PrismaService: DATABASE_URL loaded from: ${process.env.DATABASE_URL ? 'environment' : 'fallback'}`);
    console.log(`📍 PrismaService: Using database: ${url.split('@')[1]?.split('?')[0] || 'unknown'}`);

    super({ datasources: { db: { url } } });
  }
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication): Promise<void> {
    // @ts-ignore prisma runtime event typing is narrower in some versions
    this.$on('beforeExit' as any, async () => {
      await app.close();
    });
  }
}

