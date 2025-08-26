"use client";

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, Play, Trash2, Pencil, Webhook, Bell } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { CreateEditActionDialog } from './CreateEditActionDialog';
import { toast } from 'sonner';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';

export type Action = {
  id: string;
  name: string;
  description: string | null;
  taskType: string;
  taskPayload: Record<string, any> | null;
  triggers: any[];
  notifications: any[];
};

async function fetchActions(): Promise<Action[]> {
  const r = await fetch('/api/v1/actions');
  if (!r.ok) throw new Error('Failed to fetch actions');
  return r.json();
}

export default function ActionsSection() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedAction, setSelectedAction] = useState<Action | null>(null);
  const { actions: taskDrawerActions } = useTaskDrawerStore();

  const { data: actions = [], isLoading } = useQuery<Action[]>({
    queryKey: ['actions'],
    queryFn: fetchActions,
  });

  const mutationOptions = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['actions'] });
      setIsDialogOpen(false);
      setSelectedAction(null);
      toast.success('操作成功');
    },
    onError: (error: Error) => {
      toast.error('操作失败', { description: error.message });
    },
  };

  const createMutation = useMutation({
    mutationFn: (data: any) => fetch('/api/v1/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    ...mutationOptions,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => fetch(`/api/v1/actions/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    ...mutationOptions,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/v1/actions/${id}`, { method: 'DELETE' }),
    ...mutationOptions,
  });

  const runMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/v1/actions/${id}/run`, { method: 'POST' }).then(res => res.json()),
    onSuccess: (opLog) => {
      toast.success(`动作 "${opLog.title}" 已开始执行`);
      taskDrawerActions.selectTask(opLog.id);
      taskDrawerActions.setOpen(true);
    },
    onError: (error: Error) => {
      toast.error('启动失败', { description: error.message });
    },
  });

  const handleSave = (data: any) => {
    if (selectedAction) {
      updateMutation.mutate({ id: selectedAction.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>自动化动作</CardTitle>
          <Button onClick={() => { setSelectedAction(null); setIsDialogOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            新建动作
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>详情</TableHead>
                  <TableHead>触发器</TableHead>
                  <TableHead>通知</TableHead>
                  <TableHead className="w-[100px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? ( <TableRow><TableCell colSpan={6} className="h-24 text-center">加载中...</TableCell></TableRow> ) 
                : actions.length === 0 ? ( <TableRow><TableCell colSpan={6} className="h-24 text-center">未找到任何动作。</TableCell></TableRow> ) 
                : (
                  actions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell className="font-medium">{action.name}</TableCell>
                      <TableCell><Badge variant="outline">{action.taskType}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{renderTaskPayload(action)}</TableCell>
                      <TableCell><Badge variant="secondary"><Webhook className="mr-1 h-3 w-3" /> {action.triggers.length}</Badge></TableCell>
                      <TableCell><Badge variant="secondary"><Bell className="mr-1 h-3 w-3" /> {action.notifications.length}</Badge></TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => runMutation.mutate(action.id)}><Play className="mr-2 h-4 w-4" />立即运行</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setSelectedAction(action); setIsDialogOpen(true); }}><Pencil className="mr-2 h-4 w-4" />编辑</DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => deleteMutation.mutate(action.id)}><Trash2 className="mr-2 h-4 w-4" />删除</DropdownMenuItem>
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
      <CreateEditActionDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        action={selectedAction}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
    </>
  );
}

function renderTaskPayload(action: Action) {
  const payload = action.taskPayload as any;
  if (!payload) return null;
  switch (action.taskType) {
    case 'EXEC_COMMAND':
      return <><span className="font-bold">CMD:</span> {payload.command} <span className="font-bold ml-2">Hosts:</span> {payload.targetHostIds?.length || 0}</>;
    case 'DISCOVER_CONTAINERS':
      return <><span className="font-bold">Host:</span> {payload.hostId}</>;
    case 'CHECK_HOST_HEALTH':
      return <><span className="font-bold">Hosts:</span> {payload.targetHostIds?.length || 0}</>;
    default:
      return JSON.stringify(payload);
  }
}