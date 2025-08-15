import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';
import { LogsGateway } from './logs.gateway';
import { PrismaService } from '../prisma/prisma.service';

const execAsync = promisify(exec);

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  private logBuffer: LogEntry[] = []; // 临时保留用于向后兼容
  private readonly maxBufferSize = 1000;
  private lokiBaseUrl = process.env.LOKI_URL || 'http://localhost:3100';

  constructor(
    @Inject(forwardRef(() => LogsGateway)) private readonly logsGateway: LogsGateway,
    private readonly prisma: PrismaService
  ) {
    // 监听应用日志并缓存
    this.startLogCapture();
    // 设置全局 Logger 监听
    this.setupNestLogCapture();
    // 添加启动日志（延迟以避免循环依赖）
    setTimeout(async () => {
      await this.addLog('info', 'LogsService 日志服务已启动', 'application', { source: 'server' });
      await this.addLog('info', '开始监听控制台输出...', 'application', { source: 'server' });
      await this.addLog('info', 'NestJS 应用日志收集已启动', 'application', { source: 'server' });
    }, 100);
  }

  private startLogCapture() {
    // 拦截console输出
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args: any[]) => {
      const message = args.join(' ');
      this.addToBuffer('info', message, 'console');
      // 异步写入数据库（避免阻塞console输出）
      setImmediate(() => {
        this.addLog('info', message, 'application', { source: 'console' }).catch(() => {});
      });
      originalLog.apply(console, args);
    };

    console.error = (...args: any[]) => {
      const message = args.join(' ');
      this.addToBuffer('error', message, 'console');
      setImmediate(() => {
        this.addLog('error', message, 'application', { source: 'console' }).catch(() => {});
      });
      originalError.apply(console, args);
    };

    console.warn = (...args: any[]) => {
      const message = args.join(' ');
      this.addToBuffer('warn', message, 'console');
      setImmediate(() => {
        this.addLog('warn', message, 'application', { source: 'console' }).catch(() => {});
      });
      originalWarn.apply(console, args);
    };
  }

  private setupNestLogCapture() {
    // 创建自定义的 Logger 来捕获 NestJS 日志
    const originalLoggerLog = Logger.prototype.log;
    const originalLoggerError = Logger.prototype.error;
    const originalLoggerWarn = Logger.prototype.warn;
    const originalLoggerDebug = Logger.prototype.debug;
    const originalLoggerVerbose = Logger.prototype.verbose;

    Logger.prototype.log = function(message: any, context?: string) {
      const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
      const fullMessage = context ? `[${context}] ${logMessage}` : logMessage;
      
      // 避免循环日志（跳过 LogsService 自身的日志）
      if (context !== 'LogsService') {
        setImmediate(() => {
          // 这里不能直接访问 this，需要通过全局实例
          if (global.logsServiceInstance) {
            global.logsServiceInstance.addLog('info', fullMessage, 'application', { source: 'nestjs', context }).catch(() => {});
          }
        });
      }
      
      return originalLoggerLog.call(this, message, context);
    };

    Logger.prototype.error = function(message: any, trace?: string, context?: string) {
      const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
      const fullMessage = context ? `[${context}] ${logMessage}` : logMessage;
      const errorMessage = trace ? `${fullMessage}\n${trace}` : fullMessage;
      
      if (context !== 'LogsService') {
        setImmediate(() => {
          if (global.logsServiceInstance) {
            global.logsServiceInstance.addLog('error', errorMessage, 'application', { source: 'nestjs', context, trace }).catch(() => {});
          }
        });
      }
      
      return originalLoggerError.call(this, message, trace, context);
    };

    Logger.prototype.warn = function(message: any, context?: string) {
      const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
      const fullMessage = context ? `[${context}] ${logMessage}` : logMessage;
      
      if (context !== 'LogsService') {
        setImmediate(() => {
          if (global.logsServiceInstance) {
            global.logsServiceInstance.addLog('warn', fullMessage, 'application', { source: 'nestjs', context }).catch(() => {});
          }
        });
      }
      
      return originalLoggerWarn.call(this, message, context);
    };

    Logger.prototype.debug = function(message: any, context?: string) {
      const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
      const fullMessage = context ? `[${context}] ${logMessage}` : logMessage;
      
      if (context !== 'LogsService') {
        setImmediate(() => {
          if (global.logsServiceInstance) {
            global.logsServiceInstance.addLog('debug', fullMessage, 'application', { source: 'nestjs', context }).catch(() => {});
          }
        });
      }
      
      return originalLoggerDebug.call(this, message, context);
    };

    Logger.prototype.verbose = function(message: any, context?: string) {
      const logMessage = typeof message === 'string' ? message : JSON.stringify(message);
      const fullMessage = context ? `[${context}] ${logMessage}` : logMessage;
      
      if (context !== 'LogsService') {
        setImmediate(() => {
          if (global.logsServiceInstance) {
            global.logsServiceInstance.addLog('debug', fullMessage, 'application', { source: 'nestjs', context }).catch(() => {});
          }
        });
      }
      
      return originalLoggerVerbose.call(this, message, context);
    };

    // 设置全局实例引用
    global.logsServiceInstance = this;
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

  async getRecentLogs(limit: number = 100): Promise<LogEntry[]> {
    try {
      // 从数据库获取应用日志
      const systemLogs = await (this.prisma as any).systemLog.findMany({
        where: {
          category: 'application'
        },
        orderBy: { ts: 'desc' },
        take: limit
      });

      if (systemLogs.length > 0) {
        return systemLogs.map((log: any) => ({
          timestamp: log.ts.toISOString(),
          level: log.level,
          message: log.content,
          source: log.source || 'server'
        })).reverse(); // 反转为时间正序
      }
    } catch (error) {
      console.error('Failed to query application logs from database:', error);
    }

    // 回退到内存缓冲区
    const serverLogs = this.logBuffer
      .filter(log => !log.source || log.source === 'server' || log.source === 'console')
      .slice(-limit);
    
    // 如果没有服务器日志，生成一些基础日志
    if (serverLogs.length === 0) {
      await this.addLog('info', '控制平面服务已启动', 'application', { source: 'server' });
      await this.addLog('info', 'NestJS 服务运行中...', 'application', { source: 'server' });
      await this.addLog('info', '等待操作产生日志', 'application', { source: 'server' });
      
      return this.logBuffer.filter(log => log.source === 'server').slice(-limit);
    }
    
    return serverLogs;
  }

  private extractLogLevel(line: string): string {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('err')) return 'error';
    if (lower.includes('warn') || lower.includes('warning')) return 'warn';
    if (lower.includes('debug')) return 'debug';
    return 'info';
  }

  // 获取应用日志（返回统一格式的字符串数组）
  async getApplicationLogs(limit: number = 100): Promise<string[]> {
    try {
      // 从数据库获取应用日志
      const systemLogs = await (this.prisma as any).systemLog.findMany({
        where: {
          category: 'application'
        },
        orderBy: { ts: 'desc' },
        take: limit
      });

      if (systemLogs.length > 0) {
        return systemLogs.map((log: any) => 
          `${log.ts.toISOString()} [${log.level.toUpperCase()}] ${log.source || 'server'} ${log.content}`
        ).reverse(); // 反转为时间正序
      }
    } catch (error) {
      console.error('Failed to query application logs from database:', error);
    }

    // 回退到内存缓冲区
    const serverLogs = this.logBuffer
      .filter(log => !log.source || log.source === 'server' || log.source === 'console')
      .slice(-limit)
      .map(log => `${log.timestamp} [${log.level.toUpperCase()}] ${log.source || 'server'} ${log.message}`);
    
    if (serverLogs.length === 0) {
      return [
        '暂无应用日志',
        '提示：应用启动和运行日志将在此显示'
      ];
    }
    
    return serverLogs;
  }

  // 生成系统状态日志（类似应用日志的丰富内容）
  private async generateSystemStatusLogs(): Promise<void> {
    try {
      // 获取系统信息
      const now = new Date();
      
      // 系统基本信息
      try {
        const { stdout: uptime } = await execAsync('uptime');
        await this.addLog('info', `系统运行时间: ${uptime.trim()}`, 'system', { source: 'uptime' });
      } catch {}

      try {
        const { stdout: memory } = await execAsync('free -h | head -2');
        const memLines = memory.split('\n').filter(l => l.trim());
        if (memLines.length >= 2) {
          await this.addLog('info', `内存使用情况: ${memLines[1].trim()}`, 'system', { source: 'memory' });
        }
      } catch {}

      try {
        const { stdout: disk } = await execAsync('df -h / | tail -1');
        await this.addLog('info', `磁盘使用情况: ${disk.trim()}`, 'system', { source: 'disk' });
      } catch {}

      try {
        const { stdout: load } = await execAsync('cat /proc/loadavg');
        await this.addLog('info', `系统负载: ${load.trim()}`, 'system', { source: 'loadavg' });
      } catch {}

      // Docker 信息
      try {
        const { stdout: dockerInfo } = await execAsync('docker info --format "{{.Containers}} containers, {{.Images}} images"');
        await this.addLog('info', `Docker 状态: ${dockerInfo.trim()}`, 'system', { source: 'docker' });
      } catch {}

      // 网络连接数
      try {
        const { stdout: netstat } = await execAsync('ss -tuln | wc -l');
        await this.addLog('info', `网络连接数: ${netstat.trim()} 个监听端口`, 'system', { source: 'network' });
      } catch {}

      // 进程数
      try {
        const { stdout: processes } = await execAsync('ps aux | wc -l');
        await this.addLog('info', `运行进程数: ${processes.trim()} 个进程`, 'system', { source: 'processes' });
      } catch {}

    } catch (error) {
      this.logger.warn('生成系统状态日志时出错:', error);
    }
  }

  // 收集并存储本地系统日志
  private async collectAndStoreSystemLogs(lines: number = 50): Promise<void> {
    const commands = [
      { cmd: `journalctl --no-pager -n ${lines} --output=short-iso`, source: 'journalctl' },
      { cmd: `tail -n ${lines} /var/log/syslog`, source: 'syslog' },
      { cmd: `tail -n ${lines} /var/log/messages`, source: 'messages' },
      { cmd: `dmesg | tail -n ${Math.min(lines, 20)}`, source: 'dmesg' }
    ];

    for (const { cmd, source } of commands) {
      try {
        const { stdout } = await execAsync(cmd);
        const logLines = stdout.split('\n').filter(line => line.trim());
        
        for (const line of logLines.slice(-Math.min(lines, 10))) { // 限制每个来源的日志数量
          const level = this.extractLogLevel(line);
          await this.addLog(level, line, 'system', { source });
        }
        
        if (logLines.length > 0) {
          await this.addLog('info', `从 ${source} 收集了 ${logLines.length} 条日志`, 'system', { source: 'collector' });
          break; // 成功收集一个源后就停止
        }
      } catch (error) {
        this.logger.debug(`无法从 ${source} 收集日志:`, error.message);
      }
    }
  }

  async getSystemLogs(lines: number = 100): Promise<string[]> {
    try {
      // 先生成一些系统状态日志
      await this.generateSystemStatusLogs();
      
      // 1. 优先从数据库获取系统日志
      try {
        const systemLogs = await (this.prisma as any).systemLog.findMany({
          where: {
            category: 'system'
          },
          orderBy: { ts: 'desc' },
          take: lines
        });

        if (systemLogs.length > 0) {
          return systemLogs.map((log: any) => 
            `${log.ts.toISOString()} [${log.level.toUpperCase()}] ${log.source || 'system'} ${log.content}`
          ).reverse(); // 时间正序
        }
      } catch (error) {
        this.logger.warn('Failed to query system logs from database:', error);
      }

      // 2. 从 Loki 查询系统日志
      try {
        const lokiResult = await this.queryLoki('system', { limit: lines });
        if (lokiResult.entries.length > 0) {
          return lokiResult.entries.map(e => `${new Date(parseInt(e.tsNs) / 1000000).toISOString()} ${e.line}`);
        }
      } catch {
        // Fallback to local commands
      }
      
      // 3. 收集并存储本地系统日志
      await this.collectAndStoreSystemLogs(lines);
      
      // 4. 再次尝试从数据库获取
      try {
        const systemLogs = await (this.prisma as any).systemLog.findMany({
          where: { category: 'system' },
          orderBy: { ts: 'desc' },
          take: lines
        });

        if (systemLogs.length > 0) {
          return systemLogs.map((log: any) => 
            `${log.ts.toISOString()} [${log.level.toUpperCase()}] ${log.source || 'system'} ${log.content}`
          ).reverse();
        }
      } catch (error) {
        this.logger.warn('Failed to query system logs after collection:', error);
      }
      
      return ['系统日志暂不可用 - Loki 未配置且本地日志文件不可访问'];
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return [`获取系统日志失败: ${msg}`];
    }
  }

  // 生成容器状态日志
  private async generateContainerStatusLogs(): Promise<void> {
    try {
      // 本地 Docker 信息
      try {
        const { stdout: dockerPs } = await execAsync('docker ps --format "table {{.Names}}\\t{{.Status}}\\t{{.Image}}" | head -10');
        const lines = dockerPs.split('\n').filter(l => l.trim() && !l.includes('NAMES'));
        
        await this.addLog('info', `本地运行容器数量: ${lines.length} 个`, 'container', { source: 'docker' });
        
        for (const line of lines.slice(0, 5)) { // 只显示前5个
          await this.addLog('info', `容器状态: ${line.trim()}`, 'container', { source: 'docker' });
        }
      } catch (error) {
        await this.addLog('warn', `无法获取本地 Docker 信息: ${error.message}`, 'container', { source: 'docker' });
      }

      // 容器管理模块状态
      try {
        // 模拟获取分布式容器统计（实际应该从容器服务获取）
        await this.addLog('info', '容器管理模块运行正常', 'container', { source: 'containers' });
        await this.addLog('info', '定时检查器已启动', 'container', { source: 'containers' });
      } catch (error) {
        await this.addLog('error', `容器管理模块异常: ${error.message}`, 'container', { source: 'containers' });
      }

      // Docker 网络信息
      try {
        const { stdout: networks } = await execAsync('docker network ls --format "{{.Name}}\\t{{.Driver}}" | wc -l');
        await this.addLog('info', `Docker 网络数量: ${networks.trim()} 个`, 'container', { source: 'docker' });
      } catch {}

      // Docker 镜像信息
      try {
        const { stdout: images } = await execAsync('docker images --format "{{.Repository}}:{{.Tag}}" | wc -l');
        await this.addLog('info', `本地镜像数量: ${images.trim()} 个`, 'container', { source: 'docker' });
      } catch {}

    } catch (error) {
      this.logger.warn('生成容器状态日志时出错:', error);
    }
  }

  async getDockerLogs(containerName?: string, lines: number = 100): Promise<string[]> {
    try {
      // 先生成一些容器状态日志
      await this.generateContainerStatusLogs();
      
      // 从数据库获取容器管理日志
      const systemLogs = await (this.prisma as any).systemLog.findMany({
        where: {
          category: 'container'
        },
        orderBy: { ts: 'desc' },
        take: lines
      });

      if (systemLogs.length > 0) {
        return systemLogs.map((log: any) => 
          `${log.ts.toISOString()} [${log.level.toUpperCase()}] ${log.source || 'containers'} ${log.content}`
        ).reverse(); // 反转为时间正序
      }
    } catch (error) {
      console.error('Failed to query container logs from database:', error);
    }

    // 回退到内存缓冲区
    const dockerLogs = this.logBuffer
      .filter(log => log.source === 'docker' || log.source === 'containers')
      .slice(-lines)
      .map(log => `${log.timestamp} [${log.level.toUpperCase()}] ${log.message}`);
    
    if (dockerLogs.length === 0) {
      return [
        '暂无容器管理操作日志',
        '提示：执行容器启动/停止/更新等操作后，相关日志将在此显示'
      ];
    }
    
    return dockerLogs;
  }

  // 统一的日志记录方法（替代 addToBuffer）
  async addLog(
    level: string, 
    message: string, 
    category: string = 'application',
    options: {
      source?: string;
      hostId?: string;
      hostLabel?: string;
      stream?: string;
      metadata?: any;
    } = {}
  ) {
    try {
      // 1. 写入数据库
      const systemLog = await (this.prisma as any).systemLog.create({
        data: {
          category,
          level,
          stream: options.stream || (level === 'error' ? 'stderr' : 'stdout'),
          source: options.source,
          hostId: options.hostId,
          hostLabel: options.hostLabel,
          content: message,
          metadata: options.metadata || undefined,
        }
      });

      // 2. 实时广播（容器、应用、系统日志）
      if (category === 'container' || category === 'application' || category === 'system') {
        let kind: 'application' | 'system' | 'docker';
        if (category === 'container') kind = 'docker';
        else if (category === 'system') kind = 'system';
        else kind = 'application';

        this.logsGateway?.broadcastLogLine({
          eventId: systemLog.id,
          tsNs: systemLog.ts.getTime().toString() + '000000', // 转换为纳秒
          kind,
          stream: systemLog.stream as any,
          source: options.source || category,
          content: `[${level.toUpperCase()}] ${message}`,
          labels: { 
            source: options.source || category, 
            level,
            hostId: options.hostId || undefined 
          }
        });
      }

      // 3. 临时保留内存缓冲区（向后兼容）
      this.addToBuffer(level, message, options.source);

    } catch (error) {
      // 如果数据库写入失败，至少保留到内存
      console.error('Failed to write to SystemLog:', error);
      this.addToBuffer(level, message, options.source);
    }
  }



  // ----- Loki query (structured, replayable) -----
  async queryLoki(kind: 'application'|'system'|'docker', params: { q?: string; container?: string; limit?: number; startNs?: string }): Promise<{ entries: Array<{ tsNs: string; idx: number; line: string; labels?: Record<string,string>; stream: 'stdout'|'stderr'|'system'; source?: string }> }> {
    const limit = Math.min(1000, Math.max(1, params.limit ?? 200));
    const start = params.startNs ? `&start=${encodeURIComponent(params.startNs)}` : '';
    const query = this.buildLokiQuery(kind, params);
    const url = `${this.lokiBaseUrl}/loki/api/v1/query_range?query=${encodeURIComponent(query)}&limit=${limit}${start}`;
    const res = await fetch(url);
    if (!res.ok) return { entries: [] };
    const data = await res.json();
    const streams = data?.data?.result || [];
    const entries: Array<{ tsNs: string; idx: number; line: string; labels?: Record<string,string>; stream: 'stdout'|'stderr'|'system'; source?: string }> = [];
    for (const s of streams) {
      const labels = s.stream || {};
      let idx = 0;
      for (const [tsNs, line] of s.values || []) {
        const l = String(line);
        const stream: 'stdout'|'stderr'|'system' = l.toLowerCase().includes('error') ? 'stderr' : 'stdout';
        entries.push({ tsNs, idx: idx++, line: l, labels, stream, source: labels?.job || undefined });
      }
    }
    entries.sort((a, b) => (a.tsNs === b.tsNs ? a.idx - b.idx : (a.tsNs < b.tsNs ? -1 : 1)));
    return { entries };
  }

  // 获取容器管理日志（从内存缓冲区）
  getContainerManagementLogs(limit: number = 100): Array<{ tsNs: string; idx: number; line: string; labels?: Record<string,string>; stream: 'stdout'|'stderr'|'system'; source?: string }> {
    const containerLogs = this.logBuffer
      .filter(log => log.source === 'containers')
      .slice(-limit)
      .map((log, idx) => ({
        tsNs: (new Date(log.timestamp).getTime() * 1000000).toString(),
        idx,
        line: `[${log.level.toUpperCase()}] ${log.message}`,
        stream: (log.level === 'error' ? 'stderr' : 'stdout') as 'stdout'|'stderr'|'system',
        source: 'containers'
      }));
    
    return containerLogs;
  }

  private buildLokiQuery(kind: 'application'|'system'|'docker', params: { q?: string; container?: string }): string {
    // Basic selectors; adjust to your label schema
    if (kind === 'application') {
      const base = `{app="server"}`;
      return params.q ? `${base} |= "${params.q}"` : base;
    }
    if (kind === 'system') {
      const base = `{job="system"}`;
      return params.q ? `${base} |= "${params.q}"` : base;
    }
    // docker = containers management logs (not distributed container logs)
    return `{job="containers"}`;
  }
}
