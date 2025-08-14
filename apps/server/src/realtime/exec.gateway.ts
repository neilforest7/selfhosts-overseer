import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ExecGateway {
  @WebSocketServer()
  server!: Server;

  broadcast(taskId: string, event: 'data' | 'stderr' | 'end' | 'error', payload: unknown): void {
    this.server.to(`task:${taskId}`).emit(event, payload);
  }

  joinRoom(client: Socket, taskId: string): void {
    client.join(`task:${taskId}`);
  }

  @SubscribeMessage('joinTask')
  onJoinTask(@ConnectedSocket() client: Socket, @MessageBody() body: { taskId: string }) {
    if (body?.taskId) {
      this.joinRoom(client, body.taskId);
    }
  }
}

