import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { OperationLogService } from '../operation-log/operation-log.service';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ExecGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly operationLogService: OperationLogService) {}

  broadcast(taskId: string, stream: string, payload: unknown): void {
    this.server.to(`task:${taskId}`).emit(stream, payload);
  }

  joinRoom(client: Socket, taskId: string): void {
    client.join(`task:${taskId}`);
  }

  @SubscribeMessage('joinTask')
  async onJoinTask(@ConnectedSocket() client: Socket, @MessageBody() body: { taskId: string }) {
    const taskId = body?.taskId;
    if (!taskId) return;
    this.joinRoom(client, taskId);

    const opLog = await this.operationLogService.findOneWithEntries(taskId);

    if (opLog) {
      client.emit('task.logHistory', { taskId, entries: opLog.entries });
    }
  }
}

