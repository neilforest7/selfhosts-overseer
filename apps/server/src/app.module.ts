import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { SettingsModule } from './settings/settings.module';
import { HostsModule } from './hosts/hosts.module';
import { TasksModule } from './tasks/tasks.module';
import { PrismaModule } from './prisma/prisma.module';
import { ContainersModule } from './containers/containers.module';
import { ReverseProxyModule } from './reverse-proxy/reverse-proxy.module';
import { LogsModule } from './logs/logs.module';
import { FrpModule } from './frp/frp.module';
import { DnsModule } from './dns/dns.module';
import { TopologyModule } from './topology/topology.module';
import { OperationLogModule } from './operation-log/operation-log.module';
import { AutomationsModule } from './automations/automations.module';
import { ActivityLogModule } from './activity-log/activity-log.module';
import { ScheduleModule } from '@nestjs/schedule';
import { RealtimeModule } from './realtime/realtime.module';
import { ContextModule } from './context/context.module';
import { ContextMiddleware } from './context/context.middleware';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigService available throughout the application
      envFilePath: '.env', // Read from root .env file
      expandVariables: true, // Enable variable expansion like ${VAR:-default}
    }),
    DatabaseModule, // Import the new DatabaseModule for automatic migrations
    AuthModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || process.env.DEV_REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || process.env.DEV_REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
      },
    }),
    PrismaModule,
    ContextModule, // Import the new ContextModule
    SettingsModule,
    HostsModule,
    TasksModule,
    ContainersModule,
    ReverseProxyModule,
    LogsModule,
    FrpModule,
    DnsModule,
    TopologyModule,
    OperationLogModule,
    AutomationsModule,
    ActivityLogModule,
    RealtimeModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContextMiddleware).forRoutes('*'); // Apply middleware to all routes
  }
}

