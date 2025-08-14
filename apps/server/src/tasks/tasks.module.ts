import { Module, forwardRef } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { HostsModule } from '../hosts/hosts.module';
import { SettingsModule } from '../settings/settings.module';
import { SshModule } from '../ssh/ssh.module';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';

@Module({
  imports: [forwardRef(() => HostsModule), forwardRef(() => SettingsModule), SshModule],
  controllers: [TasksController],
  providers: [TasksService, ExecGateway, CryptoService]
})
export class TasksModule {}

