import { Module } from '@nestjs/common';
import { HostsController } from './hosts.controller';
import { HostsService } from './hosts.service';
import { SshModule } from '../ssh/ssh.module';
import { CryptoService } from '../security/crypto.service';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [SshModule, ActivityLogModule],
  controllers: [HostsController],
  providers: [HostsService, CryptoService],
  exports: [HostsService]
})
export class HostsModule {}

