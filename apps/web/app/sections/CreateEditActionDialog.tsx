"use client";

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, Controller } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Action } from './ActionsSection';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronsUpDown, Check, X, PlusCircle, Trash2 } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import cronstrue from 'cronstrue/i18n';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

// --- Zod Schemas ---
const actionSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  description: z.string().optional(),
  taskType: z.string(),
  taskPayload: z.any(),
});
type ActionFormValues = z.infer<typeof actionSchema>;
type Host = { id: string; name: string };

// --- API Functions ---
async function fetchHosts(): Promise<{ items: Host[] }> {
  const r = await fetch('/api/v1/hosts?limit=1000');
  if (!r.ok) throw new Error('Failed to fetch hosts');
  return r.json();
}

// --- Component Props ---
interface CreateEditActionDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  action: Action | null;
  onSave: (data: any) => void;
  isSaving: boolean;
}

export function CreateEditActionDialog({ isOpen, onOpenChange, action, onSave, isSaving }: CreateEditActionDialogProps) {
  const { data: hostsData } = useQuery({ queryKey: ['hosts', 'all'], queryFn: fetchHosts });
  const hosts = hostsData?.items || [];
  
  const form = useForm<ActionFormValues>({
    defaultValues: { name: '', description: '', taskType: 'EXEC_COMMAND', taskPayload: {} },
  });

  const taskType = form.watch('taskType');

  useEffect(() => {
    if (isOpen) {
      if (action) {
        form.reset({
          name: action.name,
          description: action.description || '',
          taskType: action.taskType,
          taskPayload: action.taskPayload || {},
        });
      } else {
        form.reset({
          name: '',
          description: '',
          taskType: 'EXEC_COMMAND',
          taskPayload: { command: 'echo "Hello"', targetHostIds: [] },
        });
      }
    }
  }, [action, form, isOpen]);

  const handleSubmit = (data: ActionFormValues) => {
    onSave(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>{action ? '编辑动作' : '新建动作'}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <Tabs defaultValue="action">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="action">1. 定义动作</TabsTrigger>
                <TabsTrigger value="triggers" disabled>2. 配置触发器</TabsTrigger>
                <TabsTrigger value="notifications" disabled>3. 设置通知</TabsTrigger>
              </TabsList>
              
              {/* Action Tab */}
              <TabsContent value="action" className="space-y-4 py-4">
                <FormField name="name" control={form.control} render={({ field }) => ( <FormItem><FormLabel>名称</FormLabel><FormControl><Input {...field} /></FormControl></FormItem> )} />
                <FormField name="description" control={form.control} render={({ field }) => ( <FormItem><FormLabel>描述</FormLabel><FormControl><Textarea {...field} /></FormControl></FormItem> )} />
                <FormField name="taskType" control={form.control} render={({ field }) => ( <FormItem><FormLabel>类型</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="EXEC_COMMAND">远程命令</SelectItem><SelectItem value="DISCOVER_CONTAINERS">发现容器</SelectItem><SelectItem value="CHECK_HOST_HEALTH">主机健康检查</SelectItem></SelectContent></Select></FormItem> )} />
                
                <Separator />

                {taskType === 'EXEC_COMMAND' && (
                  <>
                    <FormField name="taskPayload.command" control={form.control} render={({ field }) => ( <FormItem><FormLabel>命令</FormLabel><FormControl><Input {...field} /></FormControl></FormItem> )} />
                    <FormField name="taskPayload.targetHostIds" control={form.control} render={({ field }) => ( <FormItem className="flex flex-col"><FormLabel>目标主机 (多选)</FormLabel><MultiHostSelect field={field} hosts={hosts} /><FormMessage /></FormItem> )} />
                  </>
                )}
                {taskType === 'DISCOVER_CONTAINERS' && (
                  <FormField name="taskPayload.hostId" control={form.control} render={({ field }) => ( <FormItem><FormLabel>目标主机 (单选)</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="选择一个主机..." /></SelectTrigger></FormControl><SelectContent>{hosts.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select></FormItem> )} />
                )}
                {taskType === 'CHECK_HOST_HEALTH' && (
                  <FormField name="taskPayload.targetHostIds" control={form.control} render={({ field }) => ( <FormItem className="flex flex-col"><FormLabel>目标主机 (多选)</FormLabel><MultiHostSelect field={field} hosts={hosts} /><FormMessage /></FormItem> )} />
                )}
              </TabsContent>
            </Tabs>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? '保存中...' : '保存'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function MultiHostSelect({ field, hosts }: { field: any; hosts: Host[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <FormControl>
          <Button variant="outline" role="combobox" className={cn('w-full justify-between', !field.value?.length && 'text-muted-foreground' )}>
            <div className="flex gap-1 flex-wrap">
              {field.value?.map((hostId: string) => {
                const host = hosts.find(h => h.id === hostId);
                return <Badge variant="secondary" key={hostId} onClick={(e) => { e.stopPropagation(); field.onChange(field.value?.filter((id: string) => id !== hostId)); }}>{host?.name}<X className="ml-1 h-3 w-3" /></Badge>;
              }).slice(0, 5)}
              {field.value && field.value.length > 5 && <Badge>+{field.value.length - 5} more</Badge>}
              {field.value?.length === 0 && "选择主机..."}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </FormControl>
      </PopoverTrigger>
      <PopoverContent className="w-[550px] p-0">
        <Command>
          <CommandInput placeholder="搜索主机..." />
          <CommandList>
            <CommandEmpty>未找到主机.</CommandEmpty>
            <CommandGroup>
              {hosts.map((host) => (
                <CommandItem value={host.name} key={host.id} onSelect={() => {
                  const current = field.value || [];
                  const next = current.includes(host.id) ? current.filter((id: string) => id !== host.id) : [...current, host.id];
                  field.onChange(next);
                }}>
                  <Check className={cn('mr-2 h-4 w-4', (field.value || []).includes(host.id) ? 'opacity-100' : 'opacity-0')} />
                  {host.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
