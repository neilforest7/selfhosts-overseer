import { Module } from '@nestjs/common';
import { HostsController } from './hosts.controller';
import { HostsService } from './hosts.service';
import { ConnectivityService } from './connectivity.service';
import { ConnectivityProcessor, CONNECTIVITY_QUEUE_NAME } from './connectivity.processor';
import { ConnectivityCleanupService } from './connectivity-cleanup.service';
import { SshModule } from '../ssh/ssh.module';
import { CryptoService } from '../security/crypto.service';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { SettingsModule } from '../settings/settings.module';
import { BullModule } from '@nestjs/bullmq';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    SshModule,
    ActivityLogModule,
    SettingsModule,
    EventEmitterModule,
    BullModule.registerQueue({
      name: CONNECTIVITY_QUEUE_NAME,
    }),
  ],
  controllers: [HostsController],
  providers: [HostsService, ConnectivityService, ConnectivityProcessor, ConnectivityCleanupService, CryptoService],
  exports: [HostsService, ConnectivityService]
})
export class HostsModule {}

