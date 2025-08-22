import { Module, forwardRef } from '@nestjs/common';
import { ContainersService } from './containers.service';
import { ContainersController } from './containers.controller';
import { ScheduleModule } from '@nestjs/schedule';
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

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SshModule,
    LogsModule,
    SettingsModule,
    DiunModule,
    forwardRef(() => ReverseProxyModule),
    DockerModule,
    FrpModule,
    forwardRef(() => TasksModule),
  ],
  controllers: [ContainersController],
  providers: [
    ContainersService,
    ContainerCheckerProcessor,
    ExecGateway,
    CryptoService,
  ],
  exports: [ContainersService],
})
export class ContainersModule {}