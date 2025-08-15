import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ExecGateway } from './realtime/exec.gateway';
import { Logger } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  
  logger.log('🚀 Self-Host Serv Agent 正在启动...');
  
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    logger.warn('DATABASE_URL is not set; please set it in apps/server/.env');
  } else {
    logger.log('数据库连接配置已加载');
  }
  
  logger.log('创建 NestJS 应用实例...');
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true })
  );
  
  logger.log('配置 CORS 和中间件...');
  app.enableCors({ origin: true, credentials: true });
  
  logger.log('初始化 WebSocket 网关...');
  app.get(ExecGateway);
  app.useWebSocketAdapter(new IoAdapter(app));
  
  logger.log('启动服务器，监听端口 3001...');
  await app.listen({ port: 3001, host: '0.0.0.0' });
  
  logger.log('✅ Self-Host Serv Agent 启动完成！');
  logger.log('🌐 API 服务: http://localhost:3001/api/v1/');
  logger.log('🔌 WebSocket: ws://localhost:3001/');
}

bootstrap();

