import { WebSocketGateway, SubscribeMessage, MessageBody, ConnectedSocket, WebSocketServer } from '@nestjs/websockets';
import type { Socket, Server } from 'socket.io';
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { LogsService } from './logs.service';

type JoinLogsBody = {
  kind: 'application' | 'system' | 'docker';
  q?: string;
  container?: string;
  afterTsNs?: string; // inclusive lower bound in nanoseconds (Loki)
  limit?: number;
};

@WebSocketGateway({ cors: { origin: true, credentials: true } })
@Injectable()
export class LogsGateway {
  private timers = new Map<string, NodeJS.Timeout>();
  @WebSocketServer()
  server!: Server;

  constructor(@Inject(forwardRef(() => LogsService)) private readonly logs: LogsService) {}

  // 广播日志行到相应的客户端
  broadcastLogLine(event: any): void {
    if (event.kind) {
      this.server?.to(`logs:${event.kind}`).emit('logs.line', event);
    }
  }

  private timerKey(client: Socket): string {
    return client.id;
  }

  private clearTimer(client: Socket) {
    const key = this.timerKey(client);
    const t = this.timers.get(key);
    if (t) { clearInterval(t); this.timers.delete(key); }
  }

  @SubscribeMessage('joinLogs')
  async onJoinLogs(@ConnectedSocket() client: Socket, @MessageBody() body: JoinLogsBody) {
    const kind = body?.kind ?? 'application';
    const limit = Math.min(1000, Math.max(1, body?.limit ?? 200));
    let sinceNs = body?.afterTsNs; // inclusive
    
    // 加入对应类型的日志房间
    client.join(`logs:${kind}`);

    // initial replay
    let replay: { entries: Array<{ tsNs: string; idx: number; line: string; labels?: Record<string,string>; stream: 'stdout'|'stderr'|'system'; source?: string }> };
    
    if (kind === 'docker') {
      // Docker = container management logs from memory buffer
      replay = { entries: this.logs.getContainerManagementLogs(limit) };
    } else {
      // Application/System logs from Loki
      replay = await this.logs.queryLoki(kind, { q: body?.q, container: body?.container, limit, startNs: sinceNs });
    }
    
    for (const e of replay.entries) {
      client.emit('logs.line', {
        eventId: `${kind}:${e.tsNs}:${e.idx}`,
        tsNs: e.tsNs,
        kind,
        stream: e.stream,
        source: e.source,
        content: e.line,
        labels: e.labels
      });
      sinceNs = e.tsNs; // advance lower bound
    }
    client.emit('logs.replayEnd', { kind });

    // polling tail (near-real-time). If Loki tail WS is desired, can be swapped later.
    this.clearTimer(client);
    const interval = setInterval(async () => {
      try {
        let tail: { entries: Array<{ tsNs: string; idx: number; line: string; labels?: Record<string,string>; stream: 'stdout'|'stderr'|'system'; source?: string }> };
        
        if (kind === 'docker') {
          // Get latest container management logs
          tail = { entries: this.logs.getContainerManagementLogs(50) };
        } else {
          tail = await this.logs.queryLoki(kind, { q: body?.q, container: body?.container, limit: 200, startNs: sinceNs });
        }
        
        for (const e of tail.entries) {
          client.emit('logs.line', {
            eventId: `${kind}:${e.tsNs}:${e.idx}`,
            tsNs: e.tsNs,
            kind,
            stream: e.stream,
            source: e.source,
            content: e.line,
            labels: e.labels
          });
          sinceNs = e.tsNs;
        }
      } catch {}
    }, 1500);
    this.timers.set(this.timerKey(client), interval);
  }
}


