import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { forwardRef, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ExecGateway {
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(forwardRef(() => OperationLogService))
    private readonly operationLogService: OperationLogService,
    @Inject(forwardRef(() => ActivityLogService))
    private readonly activityLogService: ActivityLogService,
  ) {}

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

  @SubscribeMessage('joinActivityLog')
  async onJoinActivityLog(@ConnectedSocket() client: Socket, @MessageBody() body: { hostId?: string }) {
    // Join the activity log room
    const room = body?.hostId ? `activity:host:${body.hostId}` : 'activity:global';
    client.join(room);

    // Send recent activities
    const recentActivities = await this.activityLogService.getRecent(10);
    client.emit('activity.history', { activities: recentActivities });
  }

  @SubscribeMessage('leaveActivityLog')
  onLeaveActivityLog(@ConnectedSocket() client: Socket, @MessageBody() body: { hostId?: string }) {
    const room = body?.hostId ? `activity:host:${body.hostId}` : 'activity:global';
    client.leave(room);
  }

  // Event listener for new activity logs
  @OnEvent('activity-log.created')
  handleActivityLogCreated(activityLog: any) {
    // Broadcast to global activity room
    this.server.to('activity:global').emit('activity.new', activityLog);

    // Broadcast to host-specific room if applicable
    if (activityLog.hostId) {
      this.server.to(`activity:host:${activityLog.hostId}`).emit('activity.new', activityLog);
    }
  }
}

