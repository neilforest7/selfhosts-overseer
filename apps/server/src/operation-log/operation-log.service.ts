import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OperationStatus, TriggerType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ExecGateway } from '../realtime/exec.gateway';

@Injectable()
export class OperationLogService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ExecGateway))
    private readonly execGateway: ExecGateway,
  ) {}

  create(data: {
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
        triggerContext: data.triggerContext ?? Prisma.DbNull,
        context: data.context ?? Prisma.DbNull,
      },
    });
  }

  async log(
    operationLogId: string,
    stream: 'stdout' | 'stderr' | 'system' | 'info' | 'error',
    content: string,
    hostId?: string,
  ) {
    const entry = await this.prisma.operationLogEntry.create({
      data: {
        operationLogId,
        stream,
        content,
        hostId,
      },
    });
    this.execGateway.broadcast(operationLogId, stream, entry);
    return entry;
  }

  async addLogEntry(
    operationLogId: string,
    data: {
      stream: string;
      content: string;
      hostId?: string;
    },
  ) {
    const entry = await this.prisma.operationLogEntry.create({
      data: {
        operationLogId,
        ...data,
      },
    });
    this.execGateway.broadcast(operationLogId, data.stream, entry);
    return entry;
  }

  addLogEntries(
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
    const result = await this.prisma.operationLog.update({
      where: { id },
      data,
    });
    if (status === 'COMPLETED') {
        this.execGateway.broadcast(id, 'end', { status: 'succeeded' });
    } else if (status === 'ERROR' || status === 'CANCELLED') {
        this.execGateway.broadcast(id, 'end', { status: 'failed' });
    }
    return result;
  }

  findAll() {
    return this.prisma.operationLog.findMany({
      orderBy: {
        startTime: 'desc',
      },
      take: 50,
    });
  }

  findOneWithEntries(id: string) {
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
