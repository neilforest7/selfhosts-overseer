"use client";

import { useEffect, useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
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

export default function LogsSection() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);

  const appLogsQuery = useQuery<{ logs: LogEntry[] }>({
    queryKey: ['logs', 'application'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/logs/application?limit=200');
      if (!r.ok) throw new Error('获取应用日志失败');
      return r.json();
    },
    refetchInterval: autoRefresh ? 2000 : false,
  });

  const systemLogsQuery = useQuery<{ logs: string[] }>({
    queryKey: ['logs', 'system'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/logs/system?lines=100');
      if (!r.ok) throw new Error('获取系统日志失败');
      return r.json();
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const dockerLogsQuery = useQuery<{ logs: string[] }>({
    queryKey: ['logs', 'docker'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/logs/docker?lines=100');
      if (!r.ok) throw new Error('获取Docker日志失败');
      return r.json();
    },
    refetchInterval: autoRefresh ? 5000 : false,
  });

  // 自动滚动到底部
  useEffect(() => {
    if (autoRefresh && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [appLogsQuery.data, autoRefresh]);

  const getLevelBadgeVariant = (level: string) => {
    switch (level.toLowerCase()) {
      case 'error': return 'destructive';
      case 'warn': case 'warning': return 'secondary';
      case 'info': return 'default';
      case 'debug': return 'outline';
      default: return 'default';
    }
  };

  const filteredAppLogs = appLogsQuery.data?.logs?.filter(log => 
    !filter || log.message.toLowerCase().includes(filter.toLowerCase()) ||
    log.level.toLowerCase().includes(filter.toLowerCase())
  ) || [];

  const filteredSystemLogs = systemLogsQuery.data?.logs?.filter(log => 
    !filter || log.toLowerCase().includes(filter.toLowerCase())
  ) || [];

  const filteredDockerLogs = dockerLogsQuery.data?.logs?.filter(log => 
    !filter || log.toLowerCase().includes(filter.toLowerCase())
  ) || [];

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
              variant={autoRefresh ? 'default' : 'outline'}
              onClick={() => setAutoRefresh(!autoRefresh)}
              size="sm"
            >
              {autoRefresh ? '停止刷新' : '自动刷新'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                appLogsQuery.refetch();
                systemLogsQuery.refetch();
                dockerLogsQuery.refetch();
              }}
              size="sm"
            >
              手动刷新
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="application" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="application">
              应用日志 {appLogsQuery.data?.logs?.length ? `(${filteredAppLogs.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="system">
              系统日志 {systemLogsQuery.data?.logs?.length ? `(${filteredSystemLogs.length})` : ''}
            </TabsTrigger>
            <TabsTrigger value="docker">
              Docker日志 {dockerLogsQuery.data?.logs?.length ? `(${filteredDockerLogs.length})` : ''}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="application" className="mt-4">
            <div className="h-[600px] overflow-auto bg-muted p-4 rounded-md font-mono text-sm">
              {appLogsQuery.isLoading ? (
                <div className="text-muted-foreground">加载中...</div>
              ) : appLogsQuery.error ? (
                <div className="text-destructive">加载失败: {appLogsQuery.error.message}</div>
              ) : filteredAppLogs.length === 0 ? (
                <div className="text-muted-foreground">暂无日志</div>
              ) : (
                filteredAppLogs.map((log, index) => (
                  <div key={index} className="mb-2 flex items-start gap-2">
                    <span className="text-muted-foreground text-xs whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString()}
                    </span>
                    <Badge variant={getLevelBadgeVariant(log.level)} className="text-xs">
                      {log.level.toUpperCase()}
                    </Badge>
                    {log.source && (
                      <Badge variant="outline" className="text-xs">
                        {log.source}
                      </Badge>
                    )}
                    <span className="break-words">{log.message}</span>
                  </div>
                ))
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
                  <div key={index} className="mb-1 break-words">
                    {log}
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
                  <div key={index} className="mb-1 break-words">
                    {log}
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
