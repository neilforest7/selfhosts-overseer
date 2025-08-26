"use client";

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScheduledTask } from './TasksSection';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronsUpDown, Check, X } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import cronstrue from 'cronstrue/i18n';

// Base schema for all task types
const baseSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  description: z.string().optional(),
  taskType: z.string(),
  cron: z.string().min(1, 'CRON 表达式不能为空'),
});

// Schemas for specific task types
const execCommandSchema = baseSchema.extend({
  taskType: z.literal('EXEC_COMMAND'),
  command: z.string().min(1, '命令不能为空'),
  targetHostIds: z.array(z.string()).min(1, '至少选择一个目标主机'),
});

const discoverContainersSchema = baseSchema.extend({
  taskType: z.literal('DISCOVER_CONTAINERS'),
  hostId: z.string().min(1, '必须选择一个主机'),
});

const checkHostHealthSchema = baseSchema.extend({
  taskType: z.literal('CHECK_HOST_HEALTH'),
  targetHostIds: z.array(z.string()).min(1, '至少选择一个目标主机'),
});

// Union of all schemas
const formSchema = z.discriminatedUnion('taskType', [
  execCommandSchema,
  discoverContainersSchema,
  checkHostHealthSchema,
]);

type TaskFormValues = z.infer<typeof formSchema>;
type Host = { id: string; name: string };

async function fetchHosts(): Promise<{ items: Host[] }> {
  const r = await fetch('/api/v1/hosts?limit=1000');
  if (!r.ok) throw new Error('Failed to fetch hosts');
  return r.json();
}

interface CreateEditTaskDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  task: ScheduledTask | null;
  onSave: (data: any) => void; // Use `any` for simplicity, will construct payload before sending
  isSaving: boolean;
}

export function CreateEditTaskDialog({ isOpen, onOpenChange, task, onSave, isSaving }: CreateEditTaskDialogProps) {
  const { data: hostsData } = useQuery({ queryKey: ['hosts', 'all'], queryFn: fetchHosts });
  const hosts = hostsData?.items || [];
  const [cronDescription, setCronDescription] = useState('');

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      taskType: 'EXEC_COMMAND',
      cron: '0 0 * * *',
    },
  });

  const taskType = form.watch('taskType');
  const cronValue = form.watch('cron');

  useEffect(() => {
    try {
      if (cronValue && cronValue.split(' ').length >= 5) {
        setCronDescription(cronstrue.toString(cronValue, { locale: 'zh_CN' }));
      } else {
        setCronDescription('');
      }
    } catch (e) {
      setCronDescription('');
    }
  }, [cronValue]);

  useEffect(() => {
    if (isOpen) {
      if (task) {
        const payload = task.taskPayload as any;
        form.reset({
          name: task.name,
          description: task.description || '',
          taskType: task.taskType as any,
          cron: task.cron,
          ...payload,
        });
      } else {
        form.reset({
          name: '',
          description: '',
          taskType: 'EXEC_COMMAND',
          cron: '0 0 * * *',
          command: 'echo "Hello from $(hostname)"',
          targetHostIds: [],
        });
      }
    }
  }, [task, form, isOpen]);

  const handleSubmit = (data: TaskFormValues) => {
    const { name, description, taskType, cron, ...taskPayload } = data;
    const finalData = { name, description, taskType, cron, taskPayload };
    onSave(finalData);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{task ? '编辑任务' : '新建任务'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField name="name" control={form.control} render={({ field }) => ( <FormItem><FormLabel>名称</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
            <FormField name="description" control={form.control} render={({ field }) => ( <FormItem><FormLabel>描述</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem> )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField name="taskType" control={form.control} render={({ field }) => ( <FormItem><FormLabel>类型</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="EXEC_COMMAND">远程命令</SelectItem><SelectItem value="DISCOVER_CONTAINERS">发现容器</SelectItem><SelectItem value="CHECK_HOST_HEALTH">主机健康检查</SelectItem></SelectContent></Select><FormMessage /></FormItem> )} />
              <FormField name="cron" control={form.control} render={({ field }) => ( <FormItem><FormLabel>CRON</FormLabel><FormControl><Input {...field} /></FormControl><FormDescription className="h-4">{cronDescription}</FormDescription><FormMessage /></FormItem> )} />
            </div>
            
            {taskType === 'EXEC_COMMAND' && (
              <>
                <FormField name="command" control={form.control} render={({ field }) => ( <FormItem><FormLabel>命令</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                <FormField name="targetHostIds" control={form.control} render={({ field }) => ( <FormItem className="flex flex-col"><FormLabel>目标主机 (多选)</FormLabel><MultiHostSelect field={field} hosts={hosts} /><FormMessage /></FormItem> )} />
              </>
            )}

            {taskType === 'DISCOVER_CONTAINERS' && (
              <FormField name="hostId" control={form.control} render={({ field }) => ( <FormItem><FormLabel>目标主机 (单选)</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="选择一个主机..." /></SelectTrigger></FormControl><SelectContent>{hosts.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem> )} />
            )}

            {taskType === 'CHECK_HOST_HEALTH' && (
              <FormField name="targetHostIds" control={form.control} render={({ field }) => ( <FormItem className="flex flex-col"><FormLabel>目标主机 (多选)</FormLabel><MultiHostSelect field={field} hosts={hosts} /><FormMessage /></FormItem> )} />
            )}

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

// Reusable Multi-Host Select Component
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
                <CommandItem
                  value={host.name}
                  key={host.id}
                  onSelect={() => {
                    const current = field.value || [];
                    const next = current.includes(host.id) ? current.filter((id: string) => id !== host.id) : [...current, host.id];
                    field.onChange(next);
                  }}
                >
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