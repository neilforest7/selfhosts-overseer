import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SettingsModule } from './settings/settings.module';
import { HostsModule } from './hosts/hosts.module';
import { TasksModule } from './tasks/tasks.module';
import { PrismaModule } from './prisma/prisma.module';
import { ContainersModule } from './containers/containers.module';
import { ReverseProxyModule } from './reverse-proxy/reverse-proxy.module';
import { CertificatesModule } from './certificates/certificates.module';
import { LogsModule } from './logs/logs.module';

@Module({
  imports: [PrismaModule, SettingsModule, HostsModule, TasksModule, ContainersModule, ReverseProxyModule, CertificatesModule, LogsModule],
  controllers: [AppController],
  providers: []
})
export class AppModule {}

