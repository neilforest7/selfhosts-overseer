import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReverseProxyController } from './reverse-proxy.controller';
import { ReverseProxyService } from './reverse-proxy.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReverseProxyController],
  providers: [ReverseProxyService],
})
export class ReverseProxyModule {}


