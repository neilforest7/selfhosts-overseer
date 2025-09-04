"use client";

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, Trash2, Pencil, PlayCircle, AlertCircle, Play } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { CreateEditAutomationRuleDialog } from './CreateEditAutomationRuleDialog';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';

// Matches the Prisma model and the backend response
export type AutomationRule = {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  ruleJson: any;
  createdAt: string;
  updatedAt: string;
  _count: {
    operations: number;
  };
  errorCount: number;
};

async function fetchAutomationRules(): Promise<AutomationRule[]> {
  const r = await fetch('/api/v1/automations');
  if (!r.ok) throw new Error('Failed to fetch automation rules');
  const data = await r.json();
  return data.items || data;
}

export default function AutomationsSection() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<AutomationRule | null>(null);
  const { startOperation, fetchTasks, selectTask, setOpen } = useTaskDrawerStore((s) => s.actions);

  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ['automationRules'],
    queryFn: fetchAutomationRules,
  });

  const mutationOptions = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
      toast.success('自动化规则保存成功');
      setIsDialogOpen(false);
      setSelectedRule(null);
    },
    onError: (error: Error) => {
      toast.error('保存规则失败', { description: error.message });
    },
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<AutomationRule>) => fetch('/api/v1/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    ...mutationOptions,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AutomationRule> }) => fetch(`/api/v1/automations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    ...mutationOptions,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/v1/automations/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('删除失败');
      }
      return response;
    },
    onMutate: (id: string) => {
      const rule = rules.find(r => r.id === id);
      toast.info(`正在删除规则：${rule?.name || id}`);
    },
    onSuccess: (_, id) => {
      const rule = rules.find(r => r.id === id);
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
      toast.success(`规则删除成功：${rule?.name || id}`);
    },
    onError: (error: Error, id) => {
      const rule = rules.find(r => r.id === id);
      toast.error(`删除规则失败：${rule?.name || id}`, { description: error.message });
    },
  });

  const handleSave = (data: Partial<AutomationRule>) => {
    if (selectedRule) {
      updateMutation.mutate({ id: selectedRule.id, data });
    } else {
      createMutation.mutate(data);
    }
  };
  
  const handleToggle = (rule: AutomationRule) => {
    const newState = !rule.isEnabled;
    toast.info(`正在${newState ? '启用' : '禁用'}规则：${rule.name}`);
    updateMutation.mutate({
      id: rule.id,
      data: { isEnabled: newState }
    });
  };

  const handleTestRule = async (rule: AutomationRule) => {
    try {
      const opId = await startOperation(`测试规则 ${rule.name}`);
      toast.info(`正在测试规则：${rule.name}`);

      const response = await fetch(`/api/v1/automations/${rule.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opId })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || '测试执行失败');
      }

      const result = await response.json();
      if (result.taskId) {
        await fetchTasks();
        selectTask(result.taskId);
        setOpen(true);
        toast.success(`规则测试已启动：${rule.name}`);
      } else {
        toast.success(`规则测试完成：${rule.name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      toast.error(`规则测试失败：${rule.name}`, { description: errorMessage });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>自动化规则</CardTitle>
          <Button onClick={() => { setSelectedRule(null); setIsDialogOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            新建规则
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">启用</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>统计</TableHead>
                  <TableHead>最后修改</TableHead>
                  <TableHead className="w-[100px]">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? ( <TableRow><TableCell colSpan={5} className="h-24 text-center">加载中...</TableCell></TableRow> )
                : rules.length === 0 ? ( <TableRow><TableCell colSpan={5} className="h-24 text-center">暂无自动化规则</TableCell></TableRow> )
                : (
                  rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Switch
                          checked={rule.isEnabled}
                          onCheckedChange={() => handleToggle(rule)}
                          aria-label="Toggle rule"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{rule.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center text-sm text-muted-foreground" title="Trigger count">
                            <PlayCircle className="mr-1 h-4 w-4" />
                            {rule._count.operations}
                          </div>
                          <div className={`flex items-center text-sm ${rule.errorCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`} title="Error count">
                            <AlertCircle className="mr-1 h-4 w-4" />
                            {rule.errorCount}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{new Date(rule.updatedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleTestRule(rule)}
                              disabled={createMutation.isPending || updateMutation.isPending || deleteMutation.isPending}
                            >
                              <Play className="mr-2 h-4 w-4" />测试规则
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { setSelectedRule(rule); setIsDialogOpen(true); }}><Pencil className="mr-2 h-4 w-4" />编辑</DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => deleteMutation.mutate(rule.id)}><Trash2 className="mr-2 h-4 w-4" />删除</DropdownMenuItem>
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
      <CreateEditAutomationRuleDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        rule={selectedRule}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
    </>
  );
}