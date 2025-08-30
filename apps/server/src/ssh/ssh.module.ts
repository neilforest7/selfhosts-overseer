import { Module, forwardRef } from '@nestjs/common';
import { SshService } from './ssh.service';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ContextModule } from '../context/context.module';

@Module({
  imports: [forwardRef(() => OperationLogModule), ContextModule],
  providers: [SshService],
  exports: [SshService],
})
export class SshModule {}

