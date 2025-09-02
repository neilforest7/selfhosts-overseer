import { Module, Global } from '@nestjs/common';
import { FrpService } from './frp.service';
import { FrpController } from './frp.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { DockerModule } from '../docker/docker.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Global()
@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    DockerModule,
    OperationLogModule,
    ActivityLogModule,
  ],
  providers: [FrpService],
  controllers: [FrpController],
  exports: [FrpService],
})
export class FrpModule {}