import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { ExecGateway } from './realtime/exec.gateway';

async function bootstrap(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    // eslint-disable-next-line no-console
    console.warn('DATABASE_URL is not set; please set it in apps/server/.env');
  }
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true })
  );
  app.enableCors({ origin: true, credentials: true });
  // initialize gateway singleton
  app.get(ExecGateway);
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen({ port: 3001, host: '0.0.0.0' });
}

bootstrap();

