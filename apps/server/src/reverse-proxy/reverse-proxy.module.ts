import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReverseProxyController } from './reverse-proxy.controller';
import { ReverseProxyService } from './reverse-proxy.service';
import { ContainersModule } from '../containers/containers.module';
import { SecurityModule } from '../security/security.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => ContainersModule),
    SecurityModule,
    SettingsModule,
  ],
  controllers: [ReverseProxyController],
  providers: [ReverseProxyService],
  exports: [ReverseProxyService],
})
export class ReverseProxyModule {}