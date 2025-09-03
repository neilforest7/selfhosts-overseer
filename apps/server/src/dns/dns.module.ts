import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { DnsController } from './dns.controller';
import { DnsService } from './dns.service';
import { DnsProviderService } from './dns-provider.service';
import { DnsResolutionService } from './dns-resolution.service';
import { DnsProcessor } from './dns.processor';
import { DnsMonitoringService } from './dns-monitoring.service';
import { DnsDiscoveryService } from './dns-discovery.service';
import { CloudflareProvider } from './providers/cloudflare-provider';
import { DnsOverHttpsProvider } from './providers/dns-over-https-provider';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { OperationLogModule } from '../operation-log/operation-log.module';
import { ContextModule } from '../context/context.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    ActivityLogModule,
    OperationLogModule,
    ContextModule,
    SettingsModule,
    ScheduleModule.forRoot(),
    BullModule.registerQueue({
      name: 'dns-resolution',
    }),
  ],
  controllers: [DnsController],
  providers: [
    DnsService,
    DnsProviderService,
    DnsResolutionService,
    DnsProcessor,
    DnsMonitoringService,
    DnsDiscoveryService,
    CloudflareProvider,
    DnsOverHttpsProvider,
  ],
  exports: [
    DnsService,
    DnsProviderService,
    DnsResolutionService,
  ],
})
export class DnsModule {}
