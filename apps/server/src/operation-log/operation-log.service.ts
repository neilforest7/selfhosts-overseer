import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OperationStatus,
  TriggerType,
  OperationLog,
  OperationLogEntry,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ExecGateway } from '../realtime/exec.gateway';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { ContextService } from '../context/context.service';

interface LogPayload {
  stream: 'stdout' | 'stderr' | 'system' | 'info' | 'error';
  content: string;
  opId: string;
  hostId?: string;
}

@Injectable()
export class OperationLogService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ExecGateway))
    private readonly execGateway: ExecGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly contextService: ContextService,
  ) {}

  async create(data: {
    title: string;
    triggerType?: TriggerType;
    triggerContext?: Prisma.JsonValue;
    context?: Prisma.JsonValue;
    automationRuleId?: string;
  }): Promise<OperationLog> {
    console.log(
      `[OperationLogService] create called with title: "${data.title}"`,
    );
    const newLog = await this.prisma.operationLog.create({
      data: {
        title: data.title,
        triggerType: data.triggerType ?? TriggerType.MANUAL,
        status: 'PENDING',
        triggerContext: data.triggerContext ?? Prisma.DbNull,
        context: data.context ?? Prisma.DbNull,
        automationRuleId: data.automationRuleId,
      },
    });
    return newLog;
  }

  /**
   * Emits a log event. This is a non-async, fire-and-forget method.
   * The actual saving and broadcasting is handled by the event listener.
   */
  log(
    stream: 'stdout' | 'stderr' | 'system' | 'info' | 'error',
    content: string,
    hostId?: string,
    opIdOverride?: string, // Allow explicit opId for cross-context logging
  ): void {
    const opId = opIdOverride || this.contextService.getOpId();
    if (!opId) {
      return;
    }

    // Sanitize content before emitting to prevent UTF-8 issues
    const sanitizedContent = this.sanitizeContent(content);

    this.eventEmitter.emit('log.entry', {
      opId,
      stream,
      content: sanitizedContent,
      hostId,
    });
  }

  @OnEvent('log.entry')
  protected async handleLogEvent(
    payload: LogPayload,
  ): Promise<OperationLogEntry> {
    const { opId, stream, content, hostId } = payload;

    // Sanitize content to remove invalid UTF-8 characters
    const sanitizedContent = this.sanitizeContent(content);

    const entry = await this.prisma.operationLogEntry.create({
      data: {
        operationLogId: opId,
        stream,
        content: sanitizedContent,
        hostId: hostId,
      },
    });
    this.execGateway.broadcast(opId, stream, entry);
    return entry;
  }

  private sanitizeContent(content: string): string {
    if (!content) return content;

    // Remove null bytes and other control characters that can cause UTF-8 issues
    return content
      .replace(/\x00/g, '') // Remove null bytes
      .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove other control characters except \t, \n, \r
      .replace(/\uFFFD/g, ''); // Remove replacement characters
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
    console.log(
      `[OperationLogService] updateStatus called for opId: ${id} with status: ${status}`,
    );
    const data: { status: OperationStatus; endTime?: Date } = { status };
    if (
      status === 'COMPLETED' ||
      status === 'ERROR' ||
      status === 'CANCELLED'
    ) {
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