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
import { FrpModule } from './frp/frp.module';
import { TopologyModule } from './topology/topology.module';
import { OperationLogModule } from './operation-log/operation-log.module';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    HostsModule,
    TasksModule,
    ContainersModule,
    ReverseProxyModule,
    CertificatesModule,
    LogsModule,
    FrpModule,
    TopologyModule,
    OperationLogModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}

