import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OperationStatus, TriggerType } from '@prisma/client';
import { Prisma } from '@prisma/client';

@Injectable()
export class OperationLogService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    title: string;
    triggerType?: TriggerType;
    triggerContext?: Prisma.JsonValue;
    context?: Prisma.JsonValue;
  }) {
    console.log(`[OperationLogService] create called with title: "${data.title}"`);
    return this.prisma.operationLog.create({
      data: {
        ...data,
        status: 'PENDING',
      },
    });
  }

  async addLogEntry(
    operationLogId: string,
    data: {
      stream: string;
      content: string;
      hostId?: string;
    },
  ) {
    return this.prisma.operationLogEntry.create({
      data: {
        operationLogId,
        ...data,
      },
    });
  }

  async addLogEntries(
    operationLogId: string,
    entries: {
      stream: string;
      content: string;
      hostId?: string;
      timestamp: Date;
    }[],
  ) {
    if (entries.length === 0) return;
    return this.prisma.operationLogEntry.createMany({
      data: entries.map((e) => ({ ...e, operationLogId })),
    });
  }

  async updateStatus(id: string, status: OperationStatus) {
    console.log(`[OperationLogService] updateStatus called for opId: ${id} with status: ${status}`);
    const data: { status: OperationStatus; endTime?: Date } = { status };
    if (status === 'COMPLETED' || status === 'ERROR' || status === 'CANCELLED') {
      data.endTime = new Date();
    }
    return this.prisma.operationLog.update({
      where: { id },
      data,
    });
  }

  async findAll() {
    return this.prisma.operationLog.findMany({
      orderBy: {
        startTime: 'desc',
      },
      take: 50,
    });
  }

  async findOneWithEntries(id: string) {
    return this.prisma.operationLog.findUnique({
      where: { id },
      include: {
        entries: {
          orderBy: {
            timestamp: 'asc',
          },
        },
      },
    });
  }
}
