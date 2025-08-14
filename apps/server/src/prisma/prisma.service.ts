import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const url =
      process.env.DATABASE_URL ||
      'postgresql://selfhost:secret@localhost:5432/selfhost?schema=public';
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

