import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ScheduledTask, OperationLog } from '@prisma/client';
import { TasksService } from '../tasks/tasks.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { CronExpressionParser } from 'cron-parser';
import { HostsService } from '../hosts/hosts.service';
import { ContainersService } from '../containers/containers.service';

@Injectable()
export class ScheduledTasksService {
  constructor(
    private prisma: PrismaService,
    private tasksService: TasksService,
    private operationLogService: OperationLogService,
    private hostsService: HostsService,
    @Inject(forwardRef(() => ContainersService))
    private containersService: ContainersService,
  ) {}

  private calculateNextRun(cron: string): Date | null {
    try {
      const interval = CronExpressionParser.parse(cron);
      return interval.next().toDate();
    } catch (err) {
      return null;
    }
  }

  async create(data: Prisma.ScheduledTaskCreateInput): Promise<ScheduledTask> {
    const nextRunAt = this.calculateNextRun(data.cron);
    return this.prisma.scheduledTask.create({
      data: {
        ...data,
        nextRunAt,
      },
    });
  }

  async findAll(): Promise<ScheduledTask[]> {
    return this.prisma.scheduledTask.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string): Promise<ScheduledTask> {
    const task = await this.prisma.scheduledTask.findUnique({ where: { id } });
    if (!task) {
      throw new NotFoundException(`Scheduled task with ID "${id}" not found`);
    }
    return task;
  }

  async update(id: string, data: Prisma.ScheduledTaskUpdateInput): Promise<ScheduledTask> {
    const updateData = { ...data };
    if (typeof data.cron === 'string') {
      updateData.nextRunAt = this.calculateNextRun(data.cron);
    }
    return this.prisma.scheduledTask.update({ where: { id }, data: updateData });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.scheduledTask.delete({ where: { id } });
  }

  async runManually(id: string, triggerType: 'USER' | 'SCHEDULE' = 'USER'): Promise<OperationLog> {
    const task = await this.findOne(id);
    const opLog = await this.operationLogService.create({
      title: `${triggerType === 'USER' ? 'Manual Run' : 'Scheduled Run'}: ${task.name}`,
      triggerType,
      context: { scheduledTaskId: task.id, payload: task.taskPayload },
    });

    // Fire-and-forget the actual execution
    this.dispatchAndRun(opLog.id, task);

    return opLog;
  }

  private async dispatchAndRun(opId: string, task: ScheduledTask): Promise<void> {
    try {
      const payload = task.taskPayload as any;
      if (!payload) throw new Error('Task payload is missing or invalid.');

      switch (task.taskType) {
        case 'EXEC_COMMAND':
          if (!payload.command || !Array.isArray(payload.targetHostIds)) {
            throw new Error('Payload for EXEC_COMMAND is invalid.');
          }
          await this.tasksService.exec({
            opId,
            command: payload.command,
            targets: payload.targetHostIds,
          });
          break;

        case 'DISCOVER_CONTAINERS':
          if (!payload.hostId) throw new Error('Payload for DISCOVER_CONTAINERS is missing hostId.');
          const host = await this.hostsService.findOne(payload.hostId);
          await this.containersService.discoverOnHost(host, opId);
          break;
        
        case 'CHECK_HOST_HEALTH':
          if (!Array.isArray(payload.targetHostIds)) {
            throw new Error('Payload for CHECK_HOST_HEALTH is invalid.');
          }
          // This is a simplified version. A real implementation would be more robust.
          for (const hostId of payload.targetHostIds) {
            const result = await this.hostsService.testConnection(hostId);
            await this.operationLogService.addLogEntry(opId, {
              stream: 'system',
              content: `Host ${hostId} health check: ${result.ok ? 'OK' : 'Failed'}`,
              hostId,
            });
          }
          await this.operationLogService.updateStatus(opId, 'COMPLETED');
          break;

        default:
          throw new Error(`Unknown task type: ${task.taskType}`);
      }
    } catch (err) {
      console.error(`[TaskRunner] Error executing task ${task.id} (Op: ${opId}):`, err);
      await this.operationLogService.addLogEntry(opId, { stream: 'error', content: err.message });
      await this.operationLogService.updateStatus(opId, 'ERROR');
    }
  }
}
