import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ScheduledTask, OperationLog } from '@prisma/client';
import { TasksService } from '../tasks/tasks.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import * as parser from 'cron-parser';

@Injectable()
export class ScheduledTasksService {
  constructor(
    private prisma: PrismaService,
    private tasksService: TasksService,
    private operationLogService: OperationLogService,
  ) {}

  private calculateNextRun(cron: string): Date | null {
    try {
      // Correctly call parseExpression on the imported namespace
      const interval = parser.parseExpression(cron);
      return interval.next().toDate();
    } catch (err) {
      return null;
    }
  }

  async create(
    data: Omit<Prisma.ScheduledTaskCreateInput, 'nextRunAt'>,
  ): Promise<ScheduledTask> {
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
    const task = await this.prisma.scheduledTask.findUnique({
      where: { id },
    });
    if (!task) {
      throw new NotFoundException(`Scheduled task with ID "${id}" not found`);
    }
    return task;
  }

  async update(
    id: string,
    data: Prisma.ScheduledTaskUpdateInput,
  ): Promise<ScheduledTask> {
    const updateData: Prisma.ScheduledTaskUpdateInput = { ...data };
    if (typeof data.cron === 'string') {
      updateData.nextRunAt = this.calculateNextRun(data.cron);
    }
    return this.prisma.scheduledTask.update({
      where: { id },
      data: updateData,
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.scheduledTask.delete({
      where: { id },
    });
  }

  async runManually(id: string): Promise<OperationLog> {
    const task = await this.findOne(id);

    if (task.taskType !== 'EXEC_COMMAND') {
      throw new BadRequestException(
        `Task type "${task.taskType}" cannot be run manually yet.`,
      );
    }

    if (!task.command || !task.targetHostIds) {
      throw new BadRequestException(
        'Task is missing command or target hosts for EXEC_COMMAND.',
      );
    }

    const opLog = await this.operationLogService.create({
      title: `Manual Run: ${task.name}`,
      triggerType: 'USER',
      context: {
        scheduledTaskId: task.id,
        command: task.command,
        targets: task.targetHostIds,
      },
    });

    this.tasksService.exec({
      opId: opLog.id,
      command: task.command,
      targets: task.targetHostIds,
    });

    return opLog;
  }
}
