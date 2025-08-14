import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import { ExecRequest, TasksService, TaskRun } from './tasks.service';
import { PrismaService } from '../prisma/prisma.service';
import type { FastifyReply } from 'fastify';

@Controller('/api/v1/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService, private readonly prisma: PrismaService) {}

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string
  ) {
    const take = Math.min(100, Math.max(1, Number(limitStr) || 20));
    const where: any = status ? { status } : {};
    const runs = await this.prisma.taskRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    });
    return {
      items: runs.map((r) => ({
        id: r.id,
        status: r.status,
        request: { command: r.command, targets: r.targets },
        startedAt: r.startedAt?.toISOString(),
        finishedAt: r.finishedAt?.toISOString(),
      })),
      nextCursor: runs.length ? runs[runs.length - 1].id : null,
    };
  }

  @Post('exec')
  async exec(@Body() body: ExecRequest): Promise<TaskRun> {
    return this.tasksService.exec(body);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<TaskRun> {
    const task = await this.tasksService.get(id);
    if (!task) throw new NotFoundException('task not found');
    return task;
  }

  @Get(':id/logs')
  async getLogs(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitStr?: string
  ) {
    const take = Math.min(500, Math.max(1, Number(limitStr) || 200));
    const logs = await this.prisma.taskLog.findMany({
      where: { taskId: id },
      orderBy: { ts: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    });
    return { logs, nextCursor: logs.length ? logs[logs.length - 1].id : null };
  }

  @Get(':id/logs/export')
  async exportLogs(
    @Param('id') id: string,
    @Res() res: FastifyReply,
    @Query('format') format?: string
  ) {
    const task = await this.tasksService.get(id);
    if (!task) throw new NotFoundException('task not found');
    const logs = await this.prisma.taskLog.findMany({ where: { taskId: id }, orderBy: { ts: 'asc' } });
    const filename = `task_${id}_logs.${format === 'json' ? 'json' : 'ndjson'}`;
    res.header('Content-Disposition', `attachment; filename="${filename}"`);
    if (format === 'json') {
      res.header('Content-Type', 'application/json; charset=utf-8');
      return res.send({ task, logs });
    }
    res.header('Content-Type', 'text/plain; charset=utf-8');
    const lines = logs.map(l => JSON.stringify({ ts: l.ts, stream: l.stream, host: l.hostLabel, content: l.content }));
    return res.send(lines.join('\n'));
  }
}

