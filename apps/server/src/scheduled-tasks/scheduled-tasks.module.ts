import { Module } from '@nestjs/common';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { ScheduledTasksController } from './scheduled-tasks.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { OperationLogModule } from '../operation-log/operation-log.module';

import { ScheduledTasksProcessor } from './scheduled-tasks.processor';

@Module({
  imports: [PrismaModule, TasksModule, OperationLogModule],
  controllers: [ScheduledTasksController],
  providers: [ScheduledTasksService, ScheduledTasksProcessor],
})
export class ScheduledTasksModule {}
