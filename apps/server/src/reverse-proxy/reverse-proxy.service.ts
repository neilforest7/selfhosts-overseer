import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReverseProxyService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoutes(params: { hostId?: string }) {
    return this.prisma.reverseProxyRoute.findMany({
      where: params.hostId ? { hostId: params.hostId } : undefined,
      orderBy: { domain: 'asc' },
      take: 500,
    });
  }
}


