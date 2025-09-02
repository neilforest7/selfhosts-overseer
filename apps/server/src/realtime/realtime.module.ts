import { Module, forwardRef } from '@nestjs/common';
import { ExecGateway } from './exec.gateway';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [
    forwardRef(() => OperationLogModule),
    forwardRef(() => ActivityLogModule),
  ],
  providers: [ExecGateway],
  exports: [ExecGateway],
})
export class RealtimeModule {}
