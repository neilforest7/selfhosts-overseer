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

  joinRoom(client: Socket, taskId: string): void {
    client.join(`task:${taskId}`);
  }

  @SubscribeMessage('joinTask')
  async onJoinTask(@ConnectedSocket() client: Socket, @MessageBody() body: { taskId: string }) {
    const taskId = body?.taskId;
    if (!taskId) return;
    this.joinRoom(client, taskId);

    const opLog = await this.prisma.operationLog.findUnique({
      where: { id: taskId },
    });

    if (opLog) {
      // Send the entire log history in one event to replace client-side logs
      client.emit('task.logHistory', { taskId, logs: opLog.logs });
    }
  }
}

