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
  FormDescription,
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
import { ScheduledTask } from './TasksSection'; // Assuming type export from TasksSection
import { useEffect } from 'react';

const formSchema = z.object({
  name: z.string().min(1, '名称不能为空'),
  description: z.string().optional(),
  taskType: z.string().min(1, '任务类型不能为空'),
  cron: z.string().min(1, 'CRON 表达式不能为空'), // Basic validation, can be improved
  taskPayload: z.string().optional(), // Stored as a JSON string
});

type TaskFormValues = z.infer<typeof formSchema>;

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
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      taskType: 'EXEC_COMMAND',
      cron: '0 0 * * *',
      taskPayload: JSON.stringify({ command: 'echo hello', targets: [] }, null, 2),
    },
  });

  useEffect(() => {
    if (task) {
      form.reset({
        name: task.name,
        description: task.description || '',
        taskType: task.taskType,
        cron: task.cron,
        taskPayload: task.taskPayload
          ? JSON.stringify(task.taskPayload, null, 2)
          : '',
      });
    } else {
      form.reset({
        name: '',
        description: '',
        taskType: 'EXEC_COMMAND',
        cron: '0 0 * * *',
        taskPayload: JSON.stringify({ command: 'echo hello', targets: [] }, null, 2),
      });
    }
  }, [task, form]);

  const onSubmit = (data: TaskFormValues) => {
    onSave(data);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{task ? '编辑任务' : '新建任务'}</DialogTitle>
          <DialogDescription>
            计划任务将在指定时间自动执行。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>名称</FormLabel>
                  <FormControl>
                    <Input placeholder="例如：每日清理 Docker 虚悬镜像" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>描述 (可选)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="任务的简要说明" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="taskType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>任务类型</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="选择一个任务类型" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="EXEC_COMMAND">执行远程命令</SelectItem>
                        <SelectItem value="CHECK_CONTAINER_UPDATES" disabled>
                          检查容器更新 (即将推出)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cron"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>CRON 表达式</FormLabel>
                    <FormControl>
                      <Input placeholder="例如：0 3 * * *" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="taskPayload"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>任务参数 (JSON)</FormLabel>
                  <FormControl>
                    <Textarea rows={6} {...field} />
                  </FormControl>
                  <FormDescription>
                    这是一个 JSON 对象，用于定义任务的具体操作。
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? '保存中...' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
