import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

@Injectable()
export class LogsService {
  private logBuffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;

  constructor() {
    // 监听应用日志并缓存
    this.startLogCapture();
  }

  private startLogCapture() {
    // 拦截console输出
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args: any[]) => {
      this.addToBuffer('info', args.join(' '), 'console');
      originalLog.apply(console, args);
    };

    console.error = (...args: any[]) => {
      this.addToBuffer('error', args.join(' '), 'console');
      originalError.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      this.addToBuffer('warn', args.join(' '), 'console');
      originalWarn.apply(console, args);
    };
  }

  private addToBuffer(level: string, message: string, source?: string) {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      source
    };

    this.logBuffer.push(entry);
    
    // 保持缓冲区大小
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }
  }

  getRecentLogs(limit: number = 100): LogEntry[] {
    return this.logBuffer.slice(-limit);
  }

  async getSystemLogs(lines: number = 100): Promise<string[]> {
    try {
      // 尝试获取系统日志（journalctl 或其他方式）
      const { stdout } = await execAsync(`journalctl -u $(systemctl --user show-environment | grep -o 'USER=[^"]*' | cut -d= -f2) --no-pager -n ${lines} --output=cat 2>/dev/null || tail -n ${lines} /var/log/syslog 2>/dev/null || echo "No system logs available"`);
      return stdout.split('\n').filter(line => line.trim());
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return [`Failed to retrieve system logs: ${msg}`];
    }
  }

  async getDockerLogs(containerName?: string, lines: number = 100): Promise<string[]> {
    try {
      const cmd = containerName 
        ? `docker logs --tail ${lines} ${containerName} 2>&1`
        : `docker ps --format "table {{.Names}}" | tail -n +2 | head -5 | xargs -I {} docker logs --tail 20 {} 2>&1`;
      
      const { stdout } = await execAsync(cmd);
      return stdout.split('\n').filter(line => line.trim());
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return [`Failed to retrieve Docker logs: ${msg}`];
    }
  }

  // 添加日志到缓冲区（供其他服务调用）
  addLog(level: string, message: string, source?: string) {
    this.addToBuffer(level, message, source);
  }
}
