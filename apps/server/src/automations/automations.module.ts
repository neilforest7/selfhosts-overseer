import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';
import {
  AUTOMATION_QUEUE_NAME,
  AutomationsProcessor,
} from './automations.processor';
import { HostsModule } from '../hosts/hosts.module';
import { ContainersModule } from '../containers/containers.module';
import { OperationLogModule } from '../operation-log/operation-log.module';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue({
      name: AUTOMATION_QUEUE_NAME,
    }),
    HostsModule,
    ContainersModule,
    OperationLogModule,
  ],
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationsProcessor],
  exports: [AutomationsService],
})
export class AutomationsModule {}
