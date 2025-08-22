"use client";

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useOperationStore } from '@/lib/stores/operation-store';
import { io, type Socket } from 'socket.io-client';
import { Minimize2, ChevronsUp, Terminal, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const statusMap: Record<
  ReturnType<typeof useOperationStore.getState>['status'],
  { text: string; className: string; icon: React.ElementType; variant: 'default' | 'destructive' | null }
> = {
  running: { text: '运行中', className: 'bg-blue-500', icon: Terminal, variant: 'default' },
  completed: { text: '已完成', className: 'bg-green-500', icon: CheckCircle, variant: 'default' },
  error: { text: '有错误', className: 'bg-red-500', icon: XCircle, variant: 'destructive' },
};

const executionTypeMap: Record<ReturnType<typeof useOperationStore.getState>['executionType'], string> = {
  manual: '手动执行',
  automatic: '自动执行',
};

function formatDuration(startTime: number, endTime: number | null) {
  const start = new Date(startTime);
  const end = endTime ? new Date(endTime) : new Date();
  const seconds = ((end.getTime() - start.getTime()) / 1000).toFixed(1);
  return `${seconds}s`;
}

export function OperationDrawer() {
  const {
    opId,
    opTitle,
    logs,
    isOpen,
    isMinimized,
    startTime,
    endTime,
    status,
    executionType,
    addLog,
    endOperation,
    failOperation,
    close,
    toggleMinimize,
    setOpen,
  } = useOperationStore();
  const socketRef = useRef<Socket | null>(null);
  const logsContainerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (!isOpen || !opId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const s = io('http://localhost:3001', { transports: ['websocket'] });
    socketRef.current = s;

    s.on('connect', () => {
      s.emit('joinTask', { taskId: opId });
    });

    const onData = (d: string) => addLog(d);
    const onErr = (d: string) => failOperation(d);
    const onEnd = (p: any) => endOperation(`--- 结束: ${JSON.stringify(p)} ---`);

    s.on('data', onData);
    s.on('stderr', onErr);
    s.on('end', onEnd);

    return () => {
      s.off('data', onData);
      s.off('stderr', onErr);
      s.off('end', onEnd);
      s.disconnect();
      socketRef.current = null;
    };
  }, [isOpen, opId, addLog, endOperation, failOperation]);

  if (!isOpen) {
    return null;
  }

  const currentStatus = statusMap[status];
  const currentExecutionType = executionTypeMap[executionType];
  const Icon = currentStatus.icon;

  return (
    <>
      {isMinimized && (
        <div className="fixed bottom-4 right-4 z-50">
          <Button onClick={toggleMinimize} size="lg" className="rounded-full w-16 h-16 shadow-lg">
            <ChevronsUp className="h-8 w-8" />
          </Button>
        </div>
      )}
      <Drawer open={isOpen && !isMinimized} onOpenChange={setOpen} onClose={close}>
        <DrawerContent>
          <DrawerHeader className="flex justify-between items-start">
            <div>
              <DrawerTitle>后台任务</DrawerTitle>
              <Alert variant={currentStatus.variant} className="mt-4">
                <Icon className="h-4 w-4" />
                <AlertTitle className="space-x-4">
                  {opTitle}
                </AlertTitle>
                <AlertDescription className="space-x-4 mt-2">
                  <Badge variant="secondary" className={cn('text-white', currentStatus.className)}>
                    {currentStatus.text}
                  </Badge>
                  <Badge variant="outline">{currentExecutionType}</Badge>
                  {startTime && <span>{new Date(startTime).toLocaleString()}</span>}
                  {startTime && <span>耗时: {formatDuration(startTime, endTime)}</span>}
                </AlertDescription>
              </Alert>
            </div>
            <Button variant="ghost" size="icon" onClick={toggleMinimize}>
              <Minimize2 className="h-3 w-3" />
            </Button>
          </DrawerHeader>
          <div className="px-4 pb-4">
            <pre ref={logsContainerRef} className="h-80 overflow-auto whitespace-pre-wrap text-sm bg-muted p-3 rounded">
              {logs.join('\n')}
            </pre>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
