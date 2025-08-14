import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ExecGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly prisma: PrismaService) {}

  broadcast(taskId: string, event: 'data' | 'stderr' | 'end' | 'error', payload: unknown): void {
    this.server.to(`task:${taskId}`).emit(event, payload);
  }

  emitLog(taskId: string, payload: {
    eventId: string;
    taskId: string;
    type: 'task-start'|'task-end'|'host-start'|'host-end'|'log';
    stream: 'stdout'|'stderr'|'system';
    ts: number;
    hostId?: string;
    hostLabel?: string;
    content?: string;
  }): void {
    this.server.to(`task:${taskId}`).emit('task.log', payload);
  }

  joinRoom(client: Socket, taskId: string): void {
    client.join(`task:${taskId}`);
  }

  @SubscribeMessage('joinTask')
  async onJoinTask(@ConnectedSocket() client: Socket, @MessageBody() body: { taskId: string; afterId?: string }) {
    const taskId = body?.taskId;
    if (!taskId) return;
    this.joinRoom(client, taskId);
    // incremental replay from afterId (exclusive)
    const take = 500;
    let cursor: string | undefined = body.afterId || undefined;
    for (let i = 0; i < 50; i++) { // hard cap 25k rows per join
      const logs = await this.prisma.taskLog.findMany({
        where: { taskId },
        orderBy: [{ ts: 'asc' }, { id: 'asc' }],
        take,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
      });
      if (!logs.length) break;
      for (const l of logs) {
        client.emit('task.log', {
          eventId: l.id,
          taskId,
          type: (l.hostLabel === 'system' && l.stream === 'stdout') ? 'log' : 'log',
          stream: (l.hostLabel === 'system') ? 'system' : l.stream,
          ts: new Date((l as any).ts ?? Date.now()).getTime(),
          hostLabel: (l as any).hostLabel ?? undefined,
          content: (l as any).content ?? ''
        });
      }
      cursor = logs[logs.length - 1].id;
      if (logs.length < take) break;
    }
    client.emit('task.replayEnd', { taskId });
  }
}

