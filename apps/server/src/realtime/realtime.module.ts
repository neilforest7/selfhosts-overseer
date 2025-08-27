import { Module, forwardRef } from '@nestjs/common';
import { ExecGateway } from './exec.gateway';
import { OperationLogModule } from '../operation-log/operation-log.module';

@Module({
  imports: [forwardRef(() => OperationLogModule)],
  providers: [ExecGateway],
  exports: [ExecGateway],
})
export class RealtimeModule {}
