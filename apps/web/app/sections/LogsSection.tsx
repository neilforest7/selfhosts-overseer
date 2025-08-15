"use client";

import { useCallback, useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import io, { Socket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source?: string;
}

// 解析统一格式的日志字符串: "TIMESTAMP [LEVEL] SOURCE MESSAGE"
function parseLogString(logStr: string): LogEntry {
  const regex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s+\[(\w+)\]\s+(\w+)\s+(.+)$/;
  const match = logStr.match(regex);
  
  if (match) {
    return {
      timestamp: match[1],
      level: match[2].toLowerCase(),
      source: match[3],
      message: match[4]
    };
  }
  
  // 如果解析失败，返回默认格式
  return {
    timestamp: new Date().toISOString(),
    level: 'info',
    message: logStr,
    source: 'unknown'
  };
}

type LogLine = {
  eventId: string;
  tsNs: string;
  kind: 'application' | 'system' | 'docker';
  stream: 'stdout' | 'stderr' | 'system';
  source?: string;
  content: string;
  labels?: Record<string, string>;
};

export default function LogsSection() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'application' | 'system' | 'docker'>('application');
  const [streamingLogs, setStreamingLogs] = useState<LogLine[]>([]);
  const [useStreaming, setUseStreaming] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const seenEventIds = useRef<Set<string>>(new Set());
  const logsEndRef = useRef<HTMLDivElement>(null);

  const appLogsQuery = useQuery<{ logs: string[] }>({
    queryKey: ['logs', 'application'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/logs/application?limit=200');
      if (!r.ok) throw new Error('获取应用日志失败');
      return r.json();
    },
    refetchInterval: (autoRefresh && !useStreaming) ? 2000 : false,
    enabled: !useStreaming,
  });

  const systemLogsQuery = useQuery<{ logs: string[] }>({
    queryKey: ['logs', 'system'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/logs/system?lines=100');
      if (!r.ok) throw new Error('获取系统日志失败');
      return r.json();
    },
    refetchInterval: (autoRefresh && !useStreaming) ? 5000 : false,
    enabled: !useStreaming,
  });

  const dockerLogsQuery = useQuery<{ logs: string[] }>({
    queryKey: ['logs', 'docker'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/logs/docker?lines=100');
      if (!r.ok) throw new Error('获取Docker日志失败');
      return r.json();
    },
    refetchInterval: (autoRefresh && !useStreaming) ? 5000 : false,
    enabled: !useStreaming,
  });

  const addLogLine = useCallback((line: LogLine) => {
    if (seenEventIds.current.has(line.eventId)) return;
    seenEventIds.current.add(line.eventId);
    setStreamingLogs(prev => [...prev, line]);
  }, []);

  // 流式日志连接
  useEffect(() => {
    if (!useStreaming) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const s = io('http://localhost:3001', { transports: ['websocket'] });
    socketRef.current = s;

    s.on('connect', () => {
      s.emit('joinLogs', { kind: activeTab, limit: 200 });
    });

    s.on('logs.line', addLogLine);
    s.on('logs.replayEnd', () => { /* 可选标记 */ });

    return () => {
      s.off('logs.line', addLogLine);
      s.disconnect();
    };
  }, [useStreaming, activeTab, addLogLine]);

  // Tab 切换时重新连接
  useEffect(() => {
    if (useStreaming && socketRef.current) {
      seenEventIds.current.clear();
      setStreamingLogs([]);
      socketRef.current.emit('joinLogs', { kind: activeTab, limit: 200 });
    }
  }, [activeTab, useStreaming]);

  // 自动滚动到底部
  useEffect(() => {
    if (autoRefresh && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [appLogsQuery.data, streamingLogs.length, autoRefresh]);

  const getLevelBadgeVariant = (level: string) => {
    if (!level) return 'default';
    switch (level.toLowerCase()) {
      case 'error': return 'destructive';
      case 'warn': case 'warning': return 'secondary';
      case 'info': return 'default';
      case 'debug': return 'outline';
      default: return 'default';
    }
  };

  // 增强的日志渲染函数
  const renderEnhancedLogMessage = (log: LogEntry) => {
    const { timestamp, source, message } = log;
    
    // 根据 source 添加图标和格式化
    const getSourceIcon = (source: string) => {
      // switch (source) {
      //   case 'uptime': return <Badge variant="outline">uptime</Badge>;
      //   case 'memory': return <Badge variant="outline">memory</Badge>;
      //   case 'disk': return <Badge variant="outline">disk</Badge>;
      //   case 'loadavg': return <Badge variant="outline">loadavg</Badge>;
      //   case 'docker': return <Badge variant="outline">docker</Badge>;
      //   case 'network': return <Badge variant="outline">network</Badge>;
      //   case 'processes': return <Badge variant="outline">processes</Badge>;
      //   case 'containers': return <Badge variant="outline">containers</Badge>;
      //   case 'nestjs': return <Badge variant="outline">nestjs</Badge>;
      //   case 'server': return <Badge variant="outline">server</Badge>;
      //   case 'console': return <Badge variant="outline">console</Badge>;
      //   case 'journalctl': return <Badge variant="outline">journalctl</Badge>;
      //   case 'syslog': return <Badge variant="outline">syslog</Badge>;
      //   case 'dmesg': return <Badge variant="outline">dmesg</Badge>;
      //   case 'collector': return <Badge variant="outline">collector</Badge>;
      //   default: return <Badge variant="outline">{source}</Badge>;
      // }
      return <Badge variant="outline" className="align-middle">{source}</Badge>;
    };

    // 格式化特定类型的消息
    const formatMessage = (source: string, message: string) => {
      switch (source) {
        case 'uptime':
          const uptimeMatch = message.match(/系统运行时间:\s*(.+)/);
          if (uptimeMatch) {
            return (
              <span>
                <span className="text-blue-600 font-medium">系统运行时间:</span>
                <span className="ml-2 text-green-600">{uptimeMatch[1]}</span>
              </span>
            );
          }
          break;
        
        case 'memory':
          const memMatch = message.match(/内存使用情况:\s*(.+)/);
          if (memMatch) {
            return (
              <span>
                <span className="text-blue-600 font-medium">内存使用:</span>
                <span className="ml-2 font-mono text-orange-600">{memMatch[1]}</span>
              </span>
            );
          }
          break;
        
        case 'disk':
          const diskMatch = message.match(/磁盘使用情况:\s*(.+)/);
          if (diskMatch) {
            return (
              <span>
                <span className="text-blue-600 font-medium">磁盘使用:</span>
                <span className="ml-2 font-mono text-purple-600">{diskMatch[1]}</span>
              </span>
            );
          }
          break;
        
        case 'loadavg':
          const loadMatch = message.match(/系统负载:\s*(.+)/);
          if (loadMatch) {
            return (
              <span>
                <span className="text-blue-600 font-medium">系统负载:</span>
                <span className="ml-2 font-mono text-red-600">{loadMatch[1]}</span>
              </span>
            );
          }
          break;
        
        case 'docker':
          if (message.includes('容器数量') || message.includes('镜像数量') || message.includes('网络数量')) {
            const parts = message.split(':');
            if (parts.length === 2) {
              return (
                <span>
                  <span className="text-blue-600 font-medium">{parts[0]}:</span>
                  <span className="ml-2 text-cyan-600 font-semibold">{parts[1]}</span>
                </span>
              );
            }
          }
          if (message.includes('Docker 状态')) {
            return <span className="text-cyan-600 font-medium">{message}</span>;
          }
          break;
        
        case 'network':
          if (message.includes('网络连接数')) {
            const parts = message.split(':');
            if (parts.length === 2) {
              return (
                <span>
                  <span className="text-blue-600 font-medium">{parts[0]}:</span>
                  <span className="ml-2 text-indigo-600 font-semibold">{parts[1]}</span>
                </span>
              );
            }
          }
          break;
        
        case 'processes':
          if (message.includes('运行进程数')) {
            const parts = message.split(':');
            if (parts.length === 2) {
              return (
                <span>
                  <span className="text-blue-600 font-medium">{parts[0]}:</span>
                  <span className="ml-2 text-teal-600 font-semibold">{parts[1]}</span>
                </span>
              );
            }
          }
          break;
        
        case 'nestjs':
          if (message.includes('启动完成')) {
            return <span className="text-green-600 font-semibold">{message}</span>;
          }
          if (message.includes('successfully started')) {
            return <span className="text-green-600">{message}</span>;
          }
          if (message.includes('Mapped')) {
            return <span className="text-gray-600">{message}</span>;
          }
          break;
        
        case 'containers':
          if (message.includes('模块运行正常') || message.includes('已启动')) {
            return <span className="text-green-600">{message}</span>;
          }
          break;
      }
      
      // 默认返回原始消息
      return <span>{message}</span>;
    };

    return (
      <div className="flex items-center gap-2">
        {/* <span className="text-lg">timestamp: {timestamp}</span> */}
        <span className="text-xs" title={`来源: ${source || 'unknown'}`}>
          {getSourceIcon(source || 'unknown')}
        </span>
        <div className="flex-1">
          {formatMessage(source || 'unknown', message)}
        </div>
      </div>
    );
  };

  // 系统日志和容器日志的增强渲染
  const renderEnhancedSystemLog = (logStr: string) => {
    const parsedLog = parseLogString(logStr);
    return renderEnhancedLogMessage(parsedLog);
  };

  const filteredAppLogs = (useStreaming ? 
    streamingLogs.filter(l => l.kind === 'application').map(l => ({
      timestamp: new Date(parseInt(l.tsNs) / 1000000).toISOString(),
      level: l.stream === 'stderr' ? 'error' : 'info',
      message: l.content,
      source: l.source || 'server'
    })) :
    (appLogsQuery.data?.logs || []).map(parseLogString)
  ).filter(log => 
    !filter || log.message.toLowerCase().includes(filter.toLowerCase()) ||
    log.level.toLowerCase().includes(filter.toLowerCase())
  );

  const filteredSystemLogs = (useStreaming ?
    streamingLogs.filter(l => l.kind === 'system').map(l => l.content) :
    systemLogsQuery.data?.logs || []
  ).filter(log => 
    !filter || log.toLowerCase().includes(filter.toLowerCase())
  );

  const filteredDockerLogs = (useStreaming ?
    streamingLogs.filter(l => l.kind === 'docker').map(l => {
      const timestamp = new Date(parseInt(l.tsNs) / 1000000).toISOString();
      const source = l.source || 'container';
      return `${timestamp} [${source}] ${l.content}`;
    }) :
    dockerLogsQuery.data?.logs || []
  ).filter(log => 
    !filter || log.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>系统日志</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="过滤日志..."
              className="max-w-xs"
            />
            <Button
              variant={useStreaming ? 'default' : 'outline'}
              onClick={() => {
                setUseStreaming(!useStreaming);
                if (!useStreaming) {
                  seenEventIds.current.clear();
                  setStreamingLogs([]);
                }
              }}
              size="sm"
            >
              {useStreaming ? 'Loki 流式' : '启用流式'}
            </Button>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              onClick={() => setAutoRefresh(!autoRefresh)}
              size="sm"
              disabled={useStreaming}
            >
              {autoRefresh ? '停止刷新' : '自动刷新'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (useStreaming) {
                  seenEventIds.current.clear();
                  setStreamingLogs([]);
                  socketRef.current?.emit('joinLogs', { kind: activeTab, limit: 200 });
                } else {
                  appLogsQuery.refetch();
                  systemLogsQuery.refetch();
                  dockerLogsQuery.refetch();
                }
              }}
              size="sm"
            >
              {useStreaming ? '重新加载' : '手动刷新'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="application">
              应用日志 ({filteredAppLogs.length})
            </TabsTrigger>
            <TabsTrigger value="system">
              系统日志 ({filteredSystemLogs.length})
            </TabsTrigger>
            <TabsTrigger value="docker">
              容器日志 ({filteredDockerLogs.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="application" className="mt-4">
            <div className="h-[600px] overflow-auto bg-muted p-4 rounded-md font-mono text-sm">
              {useStreaming ? (
                filteredAppLogs.length === 0 ? (
                  <div className="text-muted-foreground">
                    {streamingLogs.length === 0 ? '等待 Loki 日志流...' : '无匹配的应用日志'}
                  </div>
                ) : (
                  filteredAppLogs.map((log, index) => (
                    <div key={index} className="mb-2 flex items-start gap-2">
                      <span className="text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      <Badge variant={getLevelBadgeVariant(log.level)} className="text-xs">
                        {log.level.toUpperCase()}
                      </Badge>
                      <div className="flex-1">
                        {renderEnhancedLogMessage(log)}
                      </div>
                    </div>
                  ))
                )
              ) : (
                appLogsQuery.isLoading ? (
                  <div className="text-muted-foreground">加载中...</div>
                ) : appLogsQuery.error ? (
                  <div className="text-destructive">加载失败: {appLogsQuery.error.message}</div>
                ) : filteredAppLogs.length === 0 ? (
                  <div className="text-muted-foreground">暂无日志</div>
                ) : (
                  filteredAppLogs.map((log, index) => (
                    <div key={index} className="mb-2 flex items-center gap-2">
                      <span className="text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                      <Badge variant={getLevelBadgeVariant(log.level)} className="text-xs">
                        {log.level.toUpperCase()}
                      </Badge>
                      <div className="flex-1">
                        {renderEnhancedLogMessage(log)}
                      </div>
                    </div>
                  ))
                )
              )}
              <div ref={logsEndRef} />
            </div>
          </TabsContent>

          <TabsContent value="system" className="mt-4">
            <div className="h-[600px] overflow-auto bg-muted p-4 rounded-md font-mono text-sm">
              {systemLogsQuery.isLoading ? (
                <div className="text-muted-foreground">加载中...</div>
              ) : systemLogsQuery.error ? (
                <div className="text-destructive">加载失败: {systemLogsQuery.error.message}</div>
              ) : filteredSystemLogs.length === 0 ? (
                <div className="text-muted-foreground">暂无系统日志</div>
              ) : (
                filteredSystemLogs.map((log, index) => (
                  <div key={index} className="mb-2">
                    {renderEnhancedSystemLog(log)}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </TabsContent>

          <TabsContent value="docker" className="mt-4">
            <div className="h-[600px] overflow-auto bg-muted p-4 rounded-md font-mono text-sm">
              {dockerLogsQuery.isLoading ? (
                <div className="text-muted-foreground">加载中...</div>
              ) : dockerLogsQuery.error ? (
                <div className="text-destructive">加载失败: {dockerLogsQuery.error.message}</div>
              ) : filteredDockerLogs.length === 0 ? (
                <div className="text-muted-foreground">暂无Docker日志</div>
              ) : (
                filteredDockerLogs.map((log, index) => (
                  <div key={index} className="mb-2">
                    {renderEnhancedSystemLog(log)}
                  </div>
                ))
              )}
              <div ref={logsEndRef} />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
