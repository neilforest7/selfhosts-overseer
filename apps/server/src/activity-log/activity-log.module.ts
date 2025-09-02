import { Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogCleanupService } from './activity-log-cleanup.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [PrismaModule, SettingsModule, EventEmitterModule],
  controllers: [ActivityLogController],
  providers: [ActivityLogService, ActivityLogCleanupService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
