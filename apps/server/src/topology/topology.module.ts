import { Module } from '@nestjs/common';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TopologyController],
  providers: [TopologyService],
})
export class TopologyModule {}
