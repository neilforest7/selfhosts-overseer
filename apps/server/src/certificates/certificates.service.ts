import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(limit = 200) {
    return this.prisma.certificate.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
}


