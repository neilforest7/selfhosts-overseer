"use client";

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScheduledTask } from './TasksSection';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronsUpDown, Check, X } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  description: z.string().optional(),
  taskType: z.string().min(1, '任务类型不能为空'),
  cron: z.string().min(1, 'CRON 表达式不能为空'),
  command: z.string().optional(),
  targetHostIds: z.array(z.string()).optional(),
});

type TaskFormValues = z.infer<typeof formSchema>;
type Host = { id: string; name: string };

async function fetchHosts(): Promise<{ items: Host[] }> {
  const r = await fetch('api/v1/hosts?limit=1000');
  if (!r.ok) throw new Error('Failed to fetch hosts');
  return r.json();
}

interface CreateEditTaskDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  task: ScheduledTask | null;
  onSave: (data: TaskFormValues) => void;
  isSaving: boolean;
}

export function CreateEditTaskDialog({
  isOpen,
  onOpenChange,
  task,
  onSave,
  isSaving,
}: CreateEditTaskDialogProps) {
  const { data: hostsData, isLoading: isLoadingHosts } = useQuery({
    queryKey: ['hosts', 'all'],
    queryFn: fetchHosts,
  });
  const hosts = hostsData?.items || [];

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      taskType: 'EXEC_COMMAND',
      cron: '0 0 * * *',
      command: 'echo hello',
      targetHostIds: [],
    },
  });

  useEffect(() => {
    if (task) {
      form.reset({
        name: task.name,
        description: task.description || '',
        taskType: task.taskType,
        cron: task.cron,
        command: task.command || '',
        targetHostIds: task.targetHostIds || [],
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
  }, [task, form, isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{task ? '编辑任务' : '新建任务'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSave)} className="space-y-4">
            {/* Name, Description, Type, Cron */}
            <FormField name="name" control={form.control} render={({ field }) => ( <FormItem><FormLabel>名称</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
            <FormField name="description" control={form.control} render={({ field }) => ( <FormItem><FormLabel>描述</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem> )} />
            <div className="grid grid-cols-2 gap-4">
              <FormField name="taskType" control={form.control} render={({ field }) => ( <FormItem><FormLabel>类型</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl><SelectContent><SelectItem value="EXEC_COMMAND">远程命令</SelectItem></SelectContent></Select><FormMessage /></FormItem> )} />
              <FormField name="cron" control={form.control} render={({ field }) => ( <FormItem><FormLabel>CRON</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
            </div>
            
            {/* Task Type Specific Fields */}
            {form.watch('taskType') === 'EXEC_COMMAND' && (
              <>
                <FormField name="command" control={form.control} render={({ field }) => ( <FormItem><FormLabel>命令</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem> )} />
                <FormField
                  control={form.control}
                  name="targetHostIds"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>目标主机</FormLabel>
                      <Popover>
                        <PopoverTrigger asChild>
                          <FormControl>
                            <Button variant="outline" role="combobox" className={cn('w-full justify-between', !field.value?.length && 'text-muted-foreground' )}>
                              <div className="flex gap-1 flex-wrap">
                                {field.value?.map(hostId => {
                                  const host = hosts.find(h => h.id === hostId);
                                  return <Badge variant="secondary" key={hostId} onClick={(e) => { e.stopPropagation(); field.onChange(field.value?.filter(id => id !== hostId)); }}>{host?.name}<X className="ml-1 h-3 w-3" /></Badge>;
                                }).slice(0, 5)}
                                {field.value && field.value.length > 5 && <Badge>+{field.value.length - 5} more</Badge>}
                                {field.value?.length === 0 && "选择主机..."}
                              </div>
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </FormControl>
                        </PopoverTrigger>
                        <PopoverContent className="w-[550px] p-0 bg-background">
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
                                      const next = current.includes(host.id) ? current.filter(id => id !== host.id) : [...current, host.id];
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
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
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