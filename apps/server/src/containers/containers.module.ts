import { Module, forwardRef } from '@nestjs/common';
import { ContainersService } from './containers.service';
import { ContainersController } from './containers.controller';

import { ContainerCheckerProcessor } from './checker.processor';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';
import { SshModule } from '../ssh/ssh.module';
import { LogsModule } from '../logs/logs.module';
import { SettingsModule } from '../settings/settings.module';
import { DiunModule } from '../diun/diun.module';
import { ReverseProxyModule } from '../reverse-proxy/reverse-proxy.module';
import { DockerModule } from '../docker/docker.module';
import { FrpModule } from '../frp/frp.module';
import { TasksModule } from '../tasks/tasks.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ContainerDiscoveryService } from './container-discovery.service';
import { ContainerLifecycleService } from './container-lifecycle.service';
import { ContainerUpdateService } from './container-update.service';
import { ContainerComposeService } from './container-compose.service';
import { ContainerStatusService } from './container-status.service';
import { ContainerBatchUpdateService } from './container-batch-update.service';
import { ContainerCliUpdateService } from './container-cli-update.service';
import { ContainerComposeUpdateService } from './container-compose-update.service';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AutomationsModule } from '../automations/automations.module';

@Module({
  imports: [
    SshModule,
    LogsModule,
    SettingsModule,
    DiunModule,
    forwardRef(() => ReverseProxyModule),
    DockerModule,
    FrpModule,
    forwardRef(() => TasksModule),
    OperationLogModule,
    ActivityLogModule,
    EventEmitterModule,
    ScheduleModule.forRoot(),
    forwardRef(() => AutomationsModule),
  ],
  controllers: [ContainersController],
  providers: [
    ContainersService,
    ContainerDiscoveryService,
    ContainerLifecycleService,
    ContainerUpdateService,
    ContainerComposeService,
    ContainerStatusService,
    ContainerBatchUpdateService,
    ContainerCliUpdateService,
    ContainerComposeUpdateService,
    ContainerCheckerProcessor,
    ExecGateway,
    CryptoService,
  ],
  exports: [ContainersService],
})
export class ContainersModule {}