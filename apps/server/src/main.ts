import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ExecGateway } from './realtime/exec.gateway';
import { Logger } from '@nestjs/common';
import { AuthInitService } from './auth/auth-init.service';
import { DatabaseMigrationService } from './database/database-migration.service';
import fastifyMultipart from '@fastify/multipart';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  
  logger.log('🚀 Selfhost Overseer 正在启动...');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn('DATABASE_URL is not set; please set it in project root .env file');
  } else {
    logger.log(`数据库连接配置已加载: ${dbUrl.split('@')[1]?.split('?')[0] || 'unknown'}`);
  }
  
  logger.log('创建 NestJS 应用实例...');
  const fastifyAdapter = new FastifyAdapter({ logger: true });
  
  // Register multipart plugin for file uploads
  await fastifyAdapter.register(fastifyMultipart as any, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
      fields: 10,
      files: 1,
    },
  });
  
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter
  );
  
  logger.log('配置 CORS 和中间件...');
  app.enableCors({ origin: true, credentials: true });
  
  logger.log('初始化 WebSocket 网关...');
  app.get(ExecGateway);
  app.useWebSocketAdapter(new IoAdapter(app));
  
  logger.log('🔄 运行数据库迁移...');
  const dbMigrationService = app.get(DatabaseMigrationService);

  // Check if migration is already in progress to prevent duplicates
  const isCurrentlyMigrating = await dbMigrationService.isMigratingNow();
  if (isCurrentlyMigrating) {
    logger.log('⏳ Migration already in progress, waiting for completion...');
    // Wait for existing migration to complete
    let attempts = 0;
    while (attempts < 30) { // Max 30 seconds wait
      await new Promise(resolve => setTimeout(resolve, 1000));
      const stillMigrating = await dbMigrationService.isMigratingNow();
      if (!stillMigrating) break;
      attempts++;
    }
  } else {
    // Run migration manually to ensure proper sequencing
    logger.log('🚀 Starting database migration...');
    await dbMigrationService.runMigrations();
  }

  // Verify database migration completed successfully before proceeding
  const migrationResult = await dbMigrationService.getLastMigrationResult();
  if (!migrationResult?.success) {
    logger.warn('⚠️ Database migration failed or incomplete, but continuing with startup...');
    logger.warn('Auth initialization may fail if User table does not exist');
  } else {
    logger.log('✅ Database migration completed successfully');
  }

  logger.log('初始化认证系统...');
  const authInitService = app.get(AuthInitService);
  await authInitService.onModuleInit();
  
  logger.log('启动服务器，监听端口 3001...');
  await app.listen({ port: 3001, host: '0.0.0.0' });
  
  logger.log('✅ Self-Host Serv Agent 启动完成！');
  logger.log('🌐 API 服务: http://localhost:3001/api/v1/');
  logger.log('🔌 WebSocket: ws://localhost:3001/');
}

bootstrap();

