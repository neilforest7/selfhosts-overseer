import { Module, forwardRef } from '@nestjs/common';
import { ExecGateway } from './exec.gateway';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { ConnectivityGateway } from './connectivity.gateway';

@Module({
  imports: [
    forwardRef(() => OperationLogModule),
    forwardRef(() => ActivityLogModule),
  ],
  providers: [ExecGateway, ConnectivityGateway],
  exports: [ExecGateway, ConnectivityGateway],
})
export class RealtimeModule {}
