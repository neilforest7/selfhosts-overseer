import { Module } from '@nestjs/common';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DnsModule } from '../dns/dns.module';

@Module({
  imports: [PrismaModule, DnsModule],
  controllers: [TopologyController],
  providers: [TopologyService],
})
export class TopologyModule {}
