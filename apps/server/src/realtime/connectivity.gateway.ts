import {
  WebSocketGateway,
  SubscribeMessage,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { HostConnectivityEvent } from '../hosts/connectivity.service';

@Injectable()
@WebSocketGateway({
  cors: {
    origin: '*', // Adjust for production
  },
})
export class ConnectivityGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ConnectivityGateway.name);
  private readonly room = 'connectivity';

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('joinConnectivity')
  handleJoinConnectivity(client: Socket, payload: any): void {
    client.join(this.room);
    this.logger.log(`Client ${client.id} joined connectivity room`);
  }

  @SubscribeMessage('leaveConnectivity')
  handleLeaveConnectivity(client: Socket, payload: any): void {
    client.leave(this.room);
    this.logger.log(`Client ${client.id} left connectivity room`);
  }

  @OnEvent('host.status.changed')
  handleHostStatusChanged(payload: HostConnectivityEvent): void {
    this.logger.log(`Broadcasting host status change to room ${this.room}: ${payload.hostName} is ${payload.currentStatus}`);
    this.server.to(this.room).emit('connectivity.status.changed', payload);
  }
}
