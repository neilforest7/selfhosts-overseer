import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CertificatesService } from './certificates.service';
import { CertificatesController } from './certificates.controller';

@Module({
  imports: [PrismaModule],
  providers: [CertificatesService],
  controllers: [CertificatesController],
})
export class CertificatesModule {}


