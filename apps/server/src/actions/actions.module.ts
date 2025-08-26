import { Module, forwardRef } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { ActionsController } from './actions.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ActionsProcessor } from './actions.processor';
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
  controllers: [ActionsController],
  providers: [ActionsService, ActionsProcessor],
  exports: [ActionsService],
})
export class ActionsModule {}
