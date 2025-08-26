import { Module, forwardRef } from '@nestjs/common';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { ScheduledTasksController } from './scheduled-tasks.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ScheduledTasksProcessor } from './scheduled-tasks.processor';
import { HostsModule } from '../hosts/hosts.module';
import { ContainersModule } from '../containers/containers.module';

@Module({
  imports: [
    PrismaModule,
    TasksModule,
    OperationLogModule,
    HostsModule,
    forwardRef(() => ContainersModule),
  ],
  controllers: [ScheduledTasksController],
  providers: [ScheduledTasksService, ScheduledTasksProcessor],
  exports: [ScheduledTasksService],
})
export class ScheduledTasksModule {}