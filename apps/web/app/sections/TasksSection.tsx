"use client";

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, Play, Trash2, Pencil } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { CreateEditTaskDialog } from './CreateEditTaskDialog';
import { toast } from 'sonner';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';

// Make sure to export the type for the dialog component
export type ScheduledTask = {
  id: string;
  name: string;
  description: string | null;
  taskType: string;
  cron: string;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  taskPayload: Record<string, any> | null;
};

async function fetchScheduledTasks(): Promise<ScheduledTask[]> {
  const r = await fetch('http://localhost:3001/api/v1/scheduled-tasks');
  if (!r.ok) throw new Error('Failed to fetch scheduled tasks');
  return r.json();
}

export default function TasksSection() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null);
  const { actions: taskDrawerActions } = useTaskDrawerStore();

  const { data: tasks = [], isLoading } = useQuery<ScheduledTask[]>({
    queryKey: ['scheduled-tasks'],
    queryFn: fetchScheduledTasks,
  });

  const mutationOptions = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-tasks'] });
      setIsDialogOpen(false);
      setSelectedTask(null);
      toast.success('操作成功');
    },
    onError: (error: Error) => {
      toast.error('操作失败', {
        description: error.message,
      });
    },
  };

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      fetch('http://localhost:3001/api/v1/scheduled-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    ...mutationOptions,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      fetch(`http://localhost:3001/api/v1/scheduled-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    ...mutationOptions,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`http://localhost:3001/api/v1/scheduled-tasks/${id}`, {
        method: 'DELETE',
      }),
    ...mutationOptions,
  });

  const runMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`http://localhost:3001/api/v1/scheduled-tasks/${id}/run`, {
        method: 'POST',
      }).then(res => res.json()),
    onSuccess: (opLog) => {
      toast.success(`任务 "${opLog.title}" 已开始执行`);
      taskDrawerActions.selectTask(opLog.id);
      taskDrawerActions.setOpen(true);
    },
    onError: (error: Error) => {
      toast.error('启动失败', { description: error.message });
    },
  });

  const handleToggle = (task: ScheduledTask) => {
    updateMutation.mutate({
      id: task.id,
      data: { isEnabled: !task.isEnabled },
    });
  };

  const handleSave = (data: any) => {
    try {
      const payload = {
        ...data,
        taskPayload: data.taskPayload ? JSON.parse(data.taskPayload) : null,
      };
      if (selectedTask) {
        updateMutation.mutate({ id: selectedTask.id, data: payload });
      } else {
        createMutation.mutate(payload);
      }
    } catch (e) {
      toast.error('任务参数格式错误', {
        description: '任务参数必须是合法的 JSON 格式。',
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>计划任务</CardTitle>
          <Button onClick={() => { setSelectedTask(null); setIsDialogOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            新建任务
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">状态</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>CRON 表达式</TableHead>
                  <TableHead>下次运行</TableHead>
                  <TableHead className="w-[100px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : tasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      未找到任何计划任务。
                    </TableCell>
                  </TableRow>
                ) : (
                  tasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell>
                        <Switch
                          checked={task.isEnabled}
                          onCheckedChange={() => handleToggle(task)}
                          aria-label="Toggle task status"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{task.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{task.taskType}</Badge>
                      </TableCell>
                      <TableCell className="font-mono">{task.cron}</TableCell>
                      <TableCell>
                        {task.nextRunAt
                          ? new Date(task.nextRunAt).toLocaleString()
                          : 'N/A'}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Open menu</span>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => runMutation.mutate(task.id)}>
                              <Play className="mr-2 h-4 w-4" />
                              立即运行
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setSelectedTask(task); setIsDialogOpen(true); }}>
                              <Pencil className="mr-2 h-4 w-4" />
                              编辑
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-red-600"
                              onClick={() => deleteMutation.mutate(task.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              删除
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <CreateEditTaskDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        task={selectedTask}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
    </>
  );
}
