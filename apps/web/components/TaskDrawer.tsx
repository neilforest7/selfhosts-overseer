"use client";

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';
import io, { type Socket } from 'socket.io-client';
import { Minimize2, ChevronsUp, Terminal, CheckCircle, XCircle, List } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const statusMap = {
  RUNNING: { text: '运行中', className: 'bg-blue-500', icon: Terminal },
  COMPLETED: { text: '已完成', className: 'bg-green-500', icon: CheckCircle },
  ERROR: { text: '有错误', className: 'bg-red-500', icon: XCircle },
};

function formatDuration(startTime: string, endTime: string | null) {
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  const seconds = ((end - start) / 1000).toFixed(1);
  return `${seconds}s`;
}

export function TaskDrawer() {
  const { isOpen, isMinimized, currentTaskId, tasks, taskOrder, actions } = useTaskDrawerStore();
  const socketRef = useRef<Socket | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const currentTask = currentTaskId ? tasks[currentTaskId] : null;

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [currentTask?.logs]);
  
  useEffect(() => {
    // Initial fetch when component mounts
    actions.fetchTasks();
  }, [actions]);

  // This effect handles polling for status updates when the drawer is open.
  useEffect(() => {
    if (!isOpen) return;

    const intervalId = setInterval(() => {
      actions.fetchTasks();
    }, 3000); // Refresh every 3 seconds

    return () => {
      clearInterval(intervalId);
    };
  }, [isOpen, actions]);

  useEffect(() => {
    if (!isOpen || !currentTaskId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('joinTask', { taskId: currentTaskId });
    } else {
        if (socketRef.current) {
            socketRef.current.disconnect();
        }
        const s = io('http://localhost:3001', { transports: ['websocket'] });
        socketRef.current = s;

        s.on('connect', () => {
            s.emit('joinTask', { taskId: currentTaskId });
        });

        s.on('task.logHistory', (data: { taskId: string; logs: string }) => {
            actions.setLogHistory(data.taskId, data.logs);
        });
        s.on('data', (log: string) => actions.addLog(currentTaskId, log));
        s.on('stderr', (log: string) => actions.addLog(currentTaskId, log));
        s.on('end', (data: { status: 'succeeded' | 'failed' }) => {
            actions.updateTaskStatus(currentTaskId, data.status === 'succeeded' ? 'COMPLETED' : 'ERROR', Date.now());
        });
    }

    return () => {
      // Do not disconnect on task switch, just leave room
      if (socketRef.current && currentTaskId) {
        // socketRef.current.emit('leaveTask', { taskId: currentTaskId });
      }
    };
  }, [isOpen, currentTaskId, actions]);

  if (!isOpen) {
    return null;
  }

  const currentStatus = currentTask ? statusMap[currentTask.status] : null;
  const Icon = currentStatus?.icon || Terminal;

  return (
    <>
      {isMinimized && (
        <div className="fixed bottom-4 right-4 z-50">
          <Button onClick={actions.toggleMinimize} size="lg" className="rounded-full w-16 h-16 shadow-lg">
            <ChevronsUp className="h-8 w-8" />
          </Button>
        </div>
      )}
      <Drawer open={isOpen && !isMinimized} onOpenChange={actions.setOpen}>
        <DrawerContent className="max-h-[80vh]">
          <DrawerHeader className="flex justify-between items-start">
            <DrawerTitle>后台任务</DrawerTitle>
            <Button variant="ghost" size="icon" onClick={actions.toggleMinimize}>
              <Minimize2 className="h-4 w-4" />
            </Button>
          </DrawerHeader>
          <div className="px-4 pb-4 grid grid-cols-12 gap-4 flex-grow min-h-0">
            {/* Left Panel: Task List */}
            <div className="col-span-3">
              <ScrollArea className="h-[60vh] pr-4">
                <div className="space-y-2">
                  {taskOrder.map((taskId) => {
                    const task = tasks[taskId];
                    const status = statusMap[task.status];
                    return (
                      <Button
                        key={task.id}
                        variant={currentTaskId === task.id ? 'secondary' : 'ghost'}
                        className="w-full justify-start h-auto py-2"
                        onClick={() => actions.selectTask(task.id)}
                      >
                        <div className="flex items-start space-x-3">
                          <status.icon className={cn("h-4 w-4 mt-1", status.className.replace('bg-', 'text-'))} />
                          <div className="text-left">
                            <p className="text-sm font-semibold">{task.title}</p>
                            <p className="text-xs text-muted-foreground">{new Date(task.startTime).toLocaleString()}</p>
                          </div>
                        </div>
                      </Button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>

            {/* Right Panel: Task Details */}
            <div className="col-span-9">
              {currentTask && currentStatus ? (
                <div className="flex flex-col h-full">
                  <Alert>
                    <Icon className="h-4 w-4" />
                    <AlertTitle>{currentTask.title}</AlertTitle>
                    <AlertDescription className="space-x-4 mt-2">
                      <Badge variant="secondary" className={cn('text-white', currentStatus.className)}>
                        {currentStatus.text}
                      </Badge>
                      <Badge variant="outline">{currentTask.executionType}</Badge>
                      <span>{new Date(currentTask.startTime).toLocaleString()}</span>
                      <span>耗时: {formatDuration(currentTask.startTime, currentTask.endTime)}</span>
                    </AlertDescription>
                  </Alert>
                  <ScrollArea className="h-[calc(60vh-80px)] mt-4">
                    <pre ref={logsContainerRef} className="whitespace-pre-wrap text-sm bg-muted p-3 rounded h-full">
                      {currentTask.logs}
                    </pre>
                  </ScrollArea>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[60vh] text-muted-foreground">
                  <List className="h-8 w-8 mr-2" />
                  <p>请从左侧选择一个任务以查看详情</p>
                </div>
              )}
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
