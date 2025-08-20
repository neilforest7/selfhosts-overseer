
import { Module } from '@nestjs/common';
import { DiunService } from './diun.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DiunController } from './diun.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DiunController],
  providers: [DiunService],
  exports: [DiunService],
})
export class DiunModule {}
