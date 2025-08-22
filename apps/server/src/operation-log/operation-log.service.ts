import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExecType, OpStatus } from '@prisma/client';

@Injectable()
export class OperationLogService {
  constructor(private prisma: PrismaService) {}

  async create(title: string, executionType: ExecType = 'MANUAL') {
    console.log(`[OperationLogService] create called with title: "${title}"`);
    try {
      const result = await this.prisma.operationLog.create({
        data: {
          title,
          executionType,
          status: 'RUNNING',
          logs: `--- Task started at: ${new Date().toLocaleString()} ---
`,
        },
      });
      console.log(`[OperationLogService] create successful for opId: ${result.id}`);
      return result;
    } catch (err) {
      console.error(`[OperationLogService] create FAILED. Error:`, err);
      throw err;
    }
  }

  async appendToLog(id: string, logContent: string) {
    try {
      // SQLite does not support append, so we need to do it manually.
      const log = await this.prisma.operationLog.findUnique({ where: { id }, select: { logs: true } });
      if (!log) return;

      const newLogs = log.logs + logContent;

      return await this.prisma.operationLog.update({
        where: { id },
        data: {
          logs: newLogs,
        },
      });
    } catch (err) {
      console.error(`[OperationLogService] appendToLog FAILED for opId: ${id}. Error:`, err);
    }
  }

  async updateStatus(id: string, status: OpStatus, errorLog?: string) {
    console.log(`[OperationLogService] updateStatus called for opId: ${id} with status: ${status}`);
    let logsToAppend = `--- Task finished with status: ${status} at: ${new Date().toLocaleString()} ---
`;
    if (errorLog) {
      logsToAppend += `
--- ERROR ---
${errorLog}
`;
    }

    try {
      const log = await this.prisma.operationLog.findUnique({ where: { id }, select: { logs: true } });
      const newLogs = (log?.logs || '') + logsToAppend;

      const result = await this.prisma.operationLog.update({
        where: { id },
        data: {
          status,
          endTime: new Date(),
          logs: newLogs,
        },
      });
      console.log(`[OperationLogService] updateStatus successful for opId: ${id}`);
      return result;
    } catch (err) {
      console.error(`[OperationLogService] updateStatus FAILED for opId: ${id}. Error:`, err);
      throw err;
    }
  }

  async findAll() {
    return this.prisma.operationLog.findMany({
      orderBy: {
        startTime: 'desc',
      },
      take: 50, // Limit to the last 50 tasks for now
    });
  }

  async findOne(id: string) {
    return this.prisma.operationLog.findUnique({
      where: { id },
    });
  }
}
