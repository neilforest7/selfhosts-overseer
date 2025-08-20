import { Module } from '@nestjs/common';
import { ContainersService } from './containers.service';
import { ContainersController } from './containers.controller';
import { ScheduleModule } from '@nestjs/schedule';
import { ContainerCheckerProcessor } from './checker.processor';
import { DockerService } from './docker.service';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';
import { SshModule } from '../ssh/ssh.module';
import { LogsModule } from '../logs/logs.module';
import { SettingsModule } from '../settings/settings.module';
import { DiunModule } from '../diun/diun.module';

@Module({
  imports: [ScheduleModule.forRoot(), SshModule, LogsModule, SettingsModule, DiunModule],
  controllers: [ContainersController],
  providers: [ContainersService, ContainerCheckerProcessor, DockerService, ExecGateway, CryptoService]
})
export class ContainersModule {}

