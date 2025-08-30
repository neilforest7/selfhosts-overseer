import { Module, forwardRef } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { HostsModule } from '../hosts/hosts.module';
import { SettingsModule } from '../settings/settings.module';
import { SshModule } from '../ssh/ssh.module';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ContainersModule } from '../containers/containers.module';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextModule } from '../context/context.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SecurityModule } from '../security/security.module';

@Module({
  imports: [
    forwardRef(() => HostsModule),
    forwardRef(() => SettingsModule),
    SshModule,
    OperationLogModule,
    forwardRef(() => ContainersModule),
    ContextModule,
    RealtimeModule,
    SecurityModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}

