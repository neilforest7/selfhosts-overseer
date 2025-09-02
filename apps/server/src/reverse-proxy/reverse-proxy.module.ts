import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReverseProxyController } from './reverse-proxy.controller';
import { ReverseProxyService } from './reverse-proxy.service';
import { ContainersModule } from '../containers/containers.module';
import { SecurityModule } from '../security/security.module';
import { SettingsModule } from '../settings/settings.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ContainersModule),
    SecurityModule,
    SettingsModule,
    OperationLogModule,
    ActivityLogModule,
  ],
  controllers: [ReverseProxyController],
  providers: [ReverseProxyService],
  exports: [ReverseProxyService],
})
export class ReverseProxyModule {}