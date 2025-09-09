"use client";

import { useEffect, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Zap, Play, Settings, Info } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchTriggerPlugins,
  fetchEventPlugins,
  type TriggerPlugin,
  type EventPlugin
} from '@/lib/api/plugins';
import { AutomationRule } from './AutomationsSection';

const formSchema = z.object({
  name: z.string().min(1, "规则名称是必需的"),
  description: z.string().optional(),
  triggerType: z.string().min(1, "触发器类型是必需的"),
  triggerConfig: z.record(z.any()).optional(),
  eventType: z.string().min(1, "事件类型是必需的"),
  eventConfig: z.record(z.any()).optional(),
});

type FormData = z.infer<typeof formSchema>;

interface Props {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  rule: AutomationRule | null;
  onSave: (data: Partial<AutomationRule>) => void;
  isSaving: boolean;
}

export function PluginBasedAutomationRuleDialog({ 
  isOpen, 
  onOpenChange, 
  rule, 
  onSave, 
  isSaving 
}: Props) {
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerPlugin | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventPlugin | null>(null);

  // Fetch available plugins
  const { data: triggerPlugins = [], isLoading: loadingTriggers } = useQuery<TriggerPlugin[]>({
    queryKey: ['triggerPlugins'],
    queryFn: fetchTriggerPlugins,
    enabled: isOpen,
  });

  const { data: eventPlugins = [], isLoading: loadingEvents } = useQuery<EventPlugin[]>({
    queryKey: ['eventPlugins'],
    queryFn: fetchEventPlugins,
    enabled: isOpen,
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      triggerType: '',
      triggerConfig: {},
      eventType: '',
      eventConfig: {},
    },
  });

  // Reset form when dialog opens/closes or rule changes
  useEffect(() => {
    if (isOpen) {
      if (rule) {
        // Parse existing rule JSON to extract trigger and event info
        const ruleJson = rule.ruleJson;
        form.reset({
          name: rule.name,
          description: rule.description || '',
          triggerType: ruleJson?.trigger?.type || '',
          triggerConfig: ruleJson?.trigger?.config || {},
          eventType: ruleJson?.event?.type || '',
          eventConfig: ruleJson?.event?.params || {},
        });
      } else {
        form.reset({
          name: '',
          description: '',
          triggerType: '',
          triggerConfig: {},
          eventType: '',
          eventConfig: {},
        });
      }
      setSelectedTrigger(null);
      setSelectedEvent(null);
    }
  }, [isOpen, rule, form]);

  // Update selected plugins when form values change
  useEffect(() => {
    const triggerType = form.watch('triggerType');
    const trigger = triggerPlugins.find(t => t.type === triggerType);
    setSelectedTrigger(trigger || null);
  }, [form.watch('triggerType'), triggerPlugins]);

  useEffect(() => {
    const eventType = form.watch('eventType');
    const event = eventPlugins.find(e => e.type === eventType);
    setSelectedEvent(event || null);
  }, [form.watch('eventType'), eventPlugins]);

  const onSubmit = (data: FormData) => {
    try {
      // Convert form data to automation rule JSON format
      const ruleJson = {
        conditions: {
          all: [{
            fact: 'trigger',
            operator: 'equal',
            value: true,
            params: {
              type: data.triggerType,
              config: data.triggerConfig
            }
          }]
        },
        event: {
          type: data.eventType,
          params: data.eventConfig
        }
      };

      const ruleData: Partial<AutomationRule> = {
        name: data.name,
        description: data.description,
        ruleJson,
        isEnabled: true,
      };

      onSave(ruleData);
    } catch (error) {
      toast.error('保存规则失败', { 
        description: error instanceof Error ? error.message : '未知错误' 
      });
    }
  };

  const renderConfigField = (key: string, schema: any, value: any, onChange: (value: any) => void) => {
    switch (schema.type) {
      case 'string':
        return (
          <div key={key} className="space-y-2">
            <FormLabel>{schema.title || key}</FormLabel>
            <Input
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={schema.placeholder}
            />
            {schema.description && (
              <p className="text-sm text-muted-foreground">{schema.description}</p>
            )}
          </div>
        );
      
      case 'number':
      case 'integer':
        return (
          <div key={key} className="space-y-2">
            <FormLabel>{schema.title || key}</FormLabel>
            <Input
              type="number"
              value={value || ''}
              onChange={(e) => onChange(schema.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value))}
              placeholder={schema.placeholder}
              min={schema.minimum}
              max={schema.maximum}
            />
            {schema.description && (
              <p className="text-sm text-muted-foreground">{schema.description}</p>
            )}
          </div>
        );
      
      default:
        return (
          <div key={key} className="space-y-2">
            <FormLabel>{schema.title || key}</FormLabel>
            <Textarea
              value={JSON.stringify(value || '')}
              onChange={(e) => {
                try {
                  onChange(JSON.parse(e.target.value));
                } catch {
                  onChange(e.target.value);
                }
              }}
              placeholder="JSON 格式"
            />
            {schema.description && (
              <p className="text-sm text-muted-foreground">{schema.description}</p>
            )}
          </div>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rule ? '编辑自动化规则' : '创建自动化规则'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>规则名称</FormLabel>
                    <FormControl>
                      <Input placeholder="输入规则名称" {...field} />
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
                    <FormLabel>描述（可选）</FormLabel>
                    <FormControl>
                      <Textarea placeholder="输入规则描述" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Trigger Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-500" />
                  触发器
                </CardTitle>
                <CardDescription>
                  选择何时触发此自动化规则
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="triggerType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>触发器类型</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="选择触发器类型" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {triggerPlugins.map((trigger) => (
                            <SelectItem key={trigger.type} value={trigger.type}>
                              <div className="flex items-center gap-2">
                                <span>{trigger.name}</span>
                                <Badge variant="outline">v{trigger.version}</Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Trigger Configuration */}
                {selectedTrigger && selectedTrigger.configSchema && (
                  <div className="space-y-4 p-4 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      <span className="font-medium">触发器配置</span>
                    </div>
                    {Object.entries(selectedTrigger.configSchema.properties || {}).map(([key, schema]) => (
                      <Controller
                        key={key}
                        name={`triggerConfig.${key}` as any}
                        control={form.control}
                        render={({ field }) => 
                          renderConfigField(key, schema, field.value, field.onChange)
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Event Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Play className="h-5 w-5 text-green-500" />
                  事件
                </CardTitle>
                <CardDescription>
                  选择触发时要执行的操作
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="eventType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>事件类型</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="选择事件类型" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {eventPlugins.map((event) => (
                            <SelectItem key={event.type} value={event.type}>
                              <div className="flex items-center gap-2">
                                <span>{event.name}</span>
                                <Badge variant="secondary">v{event.version}</Badge>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Event Configuration */}
                {selectedEvent && selectedEvent.configSchema && (
                  <div className="space-y-4 p-4 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Settings className="h-4 w-4" />
                      <span className="font-medium">事件配置</span>
                    </div>
                    {Object.entries(selectedEvent.configSchema.properties || {}).map(([key, schema]) => (
                      <Controller
                        key={key}
                        name={`eventConfig.${key}` as any}
                        control={form.control}
                        render={({ field }) => 
                          renderConfigField(key, schema, field.value, field.onChange)
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? '保存中...' : '保存规则'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
