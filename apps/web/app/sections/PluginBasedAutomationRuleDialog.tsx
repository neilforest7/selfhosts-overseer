"use client";

import { useEffect, useState, useRef } from 'react';
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
import { Zap, Play, Settings } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchTriggerPlugins,
  fetchEventPlugins,
  fetchPluginDynamicOptions,
  type TriggerPlugin,
  type EventPlugin
} from '@/lib/api/plugins';
import { AutomationRule } from './AutomationsSection';
import { PluginConfigField } from '@/components/plugin-config/PluginConfigField';
import { CronExpressionBuilder } from '@/components/plugin-config/CronExpressionBuilder';
import { CommandTemplateSelector } from '@/components/plugin-config/CommandTemplateSelector';
import { FormValidationFeedback, type ValidationResult } from '@/components/automation/FormValidationFeedback';
import { ConfigSerializer } from '@/lib/utils/config-serializer';

const formSchema = z.object({
  name: z.string().min(1, "规则名称是必需的"),
  description: z.string().optional(),
  triggerType: z.string().min(1, "触发器类型是必需的"),
  triggerConfig: z.record(z.any()).optional(),
  eventType: z.string().min(1, "事件类型是必需的"),
  eventConfig: z.record(z.any()).optional(),
}).catchall(z.any()); // Allow additional fields for nested config

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
  const [triggerDynamicOptions, setTriggerDynamicOptions] = useState<Record<string, any>>({});
  const [eventDynamicOptions, setEventDynamicOptions] = useState<Record<string, any>>({});
  const [validationResult, setValidationResult] = useState<ValidationResult>({
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: []
  });

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

  // Debug logging for key uniqueness (can be removed in production)
  useEffect(() => {
    if (triggerPlugins.length > 0) {
      const ids = triggerPlugins.map(t => t.id);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        console.warn('Duplicate trigger plugin IDs detected:', ids);
      }
    }
  }, [triggerPlugins]);

  useEffect(() => {
    if (eventPlugins.length > 0) {
      const ids = eventPlugins.map(e => e.id);
      const uniqueIds = new Set(ids);
      if (ids.length !== uniqueIds.size) {
        console.warn('Duplicate event plugin IDs detected:', ids);
      }
    }
  }, [eventPlugins]);

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

  // 避免插件异步加载完成后重复 reset 覆盖用户编辑
  const initializedRef = useRef(false);

  // 当对话框关闭或 rule 变化时，重置初始化标记
  useEffect(() => {
    if (!isOpen) {
      initializedRef.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    initializedRef.current = false;
  }, [rule?.id]);

  // Reset form only once when dialog opens with data ready
  useEffect(() => {
    if (!isOpen) return;
    if (initializedRef.current) return; // 已初始化，避免覆盖用户修改
    if (loadingTriggers || loadingEvents) return;
    if (triggerPlugins.length === 0 || eventPlugins.length === 0) return;

    if (rule) {
      const formData = ConfigSerializer.ruleToFormData(rule);
      console.log('🔄 Using ConfigSerializer to populate form (once):', formData);
      form.reset(formData);

      const trigger = triggerPlugins.find(t => t.triggerType === formData.triggerType);
      const event = eventPlugins.find(e => e.eventType === formData.eventType);
      setSelectedTrigger(trigger || null);
      setSelectedEvent(event || null);
    } else {
      form.reset({
        name: '',
        description: '',
        triggerType: '',
        triggerConfig: {},
        eventType: '',
        eventConfig: {},
      });
      setSelectedTrigger(null);
      setSelectedEvent(null);
    }

    initializedRef.current = true;
  }, [isOpen, rule, form, loadingTriggers, loadingEvents, triggerPlugins, eventPlugins]);

  // Update selected plugins when form values change
  useEffect(() => {
    if (loadingTriggers || triggerPlugins.length === 0) return;

    const triggerType = form.watch('triggerType');
    const trigger = triggerPlugins.find(t => t.triggerType === triggerType);
    setSelectedTrigger(trigger || null);
  }, [form.watch('triggerType'), triggerPlugins, loadingTriggers]);

  useEffect(() => {
    if (loadingEvents || eventPlugins.length === 0) return;

    const eventType = form.watch('eventType');
    const event = eventPlugins.find(e => e.eventType === eventType);
    setSelectedEvent(event || null);
  }, [form.watch('eventType'), eventPlugins, loadingEvents]);

  // Fetch dynamic options when trigger is selected
  useEffect(() => {
    if (!selectedTrigger || !selectedTrigger.id) {
      setTriggerDynamicOptions({});
      return;
    }

    const fetchTriggerOptions = async () => {
      try {
        // Use dynamic options from the plugin data if available
        if (selectedTrigger.dynamicOptions) {
          setTriggerDynamicOptions(selectedTrigger.dynamicOptions);
        } else {
          // Fallback to fetching from API
          const options = await fetchPluginDynamicOptions(selectedTrigger.id);
          setTriggerDynamicOptions(options);
        }
      } catch (error) {
        console.error('Failed to fetch trigger dynamic options:', error);
        setTriggerDynamicOptions({});
      }
    };

    fetchTriggerOptions();
  }, [selectedTrigger]);

  // Fetch dynamic options when event is selected
  useEffect(() => {
    if (!selectedEvent || !selectedEvent.id) {
      setEventDynamicOptions({});
      return;
    }

    const fetchEventOptions = async () => {
      try {
        // Use dynamic options from the plugin data if available
        if (selectedEvent.dynamicOptions) {
          setEventDynamicOptions(selectedEvent.dynamicOptions);
        } else {
          // Fallback to fetching from API
          const options = await fetchPluginDynamicOptions(selectedEvent.id);
          setEventDynamicOptions(options);
        }
      } catch (error) {
        console.error('Failed to fetch event dynamic options:', error);
        setEventDynamicOptions({});
      }
    };

    fetchEventOptions();
  }, [selectedEvent]);

  const onSubmit = (_data: FormData) => {
    // 始终从 RHF 取“最新值”，避免闭包或事件节流导致的陈旧数据
    const data = form.getValues();
    console.log('🚀 Enhanced Dialog onSubmit called with form data (latest):', data);

    try {
      // 验证表单数据
      if (!validationResult.isValid) {
        toast.error(`表单验证失败: ${validationResult.errors.join(', ')}`);
        return;
      }

      // Find the selected plugins to get their IDs and versions
      const selectedTriggerPlugin = triggerPlugins.find(t => t.triggerType === data.triggerType);
      const selectedEventPlugin = eventPlugins.find(e => e.eventType === data.eventType);

      if (!selectedTriggerPlugin) {
        throw new Error(`未找到触发器插件: ${data.triggerType}`);
      }
      if (!selectedEventPlugin) {
        throw new Error(`未找到事件插件: ${data.eventType}`);
      }
      if (!selectedTriggerPlugin.dbPluginId) {
        throw new Error(`触发器插件缺少数据库ID: ${data.triggerType}`);
      }
      if (!selectedEventPlugin.dbPluginId) {
        throw new Error(`事件插件缺少数据库ID: ${data.eventType}`);
      }

      // 使用ConfigSerializer进行数据转换
      const ruleData = ConfigSerializer.formDataToNormalizedRule(
        data,
        selectedTriggerPlugin.dbPluginId,
        selectedTriggerPlugin.version,
        selectedEventPlugin.dbPluginId,
        selectedEventPlugin.version
      );

      console.log('✅ Final rule data to be sent to API:', ruleData);

      // Call the parent's onSave function
      onSave(ruleData as unknown as Partial<AutomationRule>);
    } catch (error) {
      toast.error('保存规则失败', {
        description: error instanceof Error ? error.message : '未知错误'
      });
    }
  };

  const renderConfigField = (key: string, schema: any, value: any, onChange: (value: any) => void) => {
    // Special handling for CRON expressions
    if (key === 'expression' && selectedTrigger?.triggerType === 'cron') {
      return (
        <div key={key} className="space-y-2">
          <FormLabel>CRON表达式</FormLabel>
          <CronExpressionBuilder
            value={value || ''}
            onChange={onChange}
          />
        </div>
      );
    }

    // Special handling for command fields
    if (key === 'command' && selectedEvent?.eventType === 'execute-command') {
      return (
        <div key={key} className="space-y-2">
          <FormLabel>Shell命令</FormLabel>
          <CommandTemplateSelector
            value={value || ''}
            onChange={onChange}
          />
        </div>
      );
    }

    // Use enhanced plugin config field for all other cases
    return (
      <PluginConfigField
        key={key}
        fieldKey={key}
        schema={schema}
        value={value}
        onChange={onChange}
        // Map dynamic options from plugins to expected format
        availableHosts={(triggerDynamicOptions.hostId || triggerDynamicOptions.hostIds || eventDynamicOptions.hostId || eventDynamicOptions.hostIds || []).map((option: any) => ({
          id: option.value,
          name: option.label,
          hostName: option.description?.replace('Host: ', '') || option.label
        }))}
        availableContainers={(triggerDynamicOptions.containerId || triggerDynamicOptions.containerIdentifier || triggerDynamicOptions.containerIds || triggerDynamicOptions.containerIdentifiers || eventDynamicOptions.containerId || eventDynamicOptions.containerIdentifier || eventDynamicOptions.containerIds || eventDynamicOptions.containerIdentifiers || []).map((option: any, index: number) => {
          const hostName = option.description?.match(/Host: (.+?) \|/)?.[1] || option.description?.replace('Host: ', '') || 'Unknown Host';
          return {
            id: `${option.value}-${hostName}-${index}`, // 使用组合的唯一标识符
            originalId: option.value, // 保留原始ID用于API调用
            name: option.label,
            hostName: hostName
          };
        })}
        availableUsers={(triggerDynamicOptions.userId || triggerDynamicOptions.userIds || eventDynamicOptions.userId || eventDynamicOptions.userIds || []).map((option: any) => ({
          id: option.value,
          name: option.label
        }))}
      />
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {rule ? '编辑自动化规则' : '创建自动化规则'}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit, (errors) => {
            console.log('Form validation errors:', errors);
          })} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                      <Textarea placeholder="输入规则描述" {...field} className="min-h-[80px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Trigger and Event Selection - Side by Side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                            {loadingTriggers ? (
                              <SelectItem key="loading" value="__loading__" disabled>
                                <div className="flex items-center gap-2">
                                  <span>加载中...</span>
                                </div>
                              </SelectItem>
                            ) : (
                              triggerPlugins.map((trigger) => (
                                <SelectItem
                                  key={trigger.id || `trigger-${trigger.triggerType}-${trigger.name}`}
                                  value={trigger.triggerType}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="truncate">{trigger.name}</span>
                                    <Badge variant="outline" className="text-xs">v{trigger.version}</Badge>
                                  </div>
                                </SelectItem>
                              ))
                            )}
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
                        <span className="font-medium text-sm">触发器配置</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-3">
                        {Object.entries(selectedTrigger.configSchema.properties || {}).map(([key, schema]) => (
                          <Controller
                            key={key}
                            name={`triggerConfig.${key}` as any}
                            control={form.control}
                            defaultValue={(schema as any)?.default || ''}
                            render={({ field }) => {
                              console.log(`🎨 Rendering trigger config field: ${key}, value:`, field.value, 'name:', `triggerConfig.${key}`);
                              return renderConfigField(key, schema, field.value, (newValue) => {
                                console.log(`🔄 Trigger config field ${key} changed from:`, field.value, 'to:', newValue);
                                field.onChange(newValue);

                                // 同时更新嵌套对象，确保数据一致性
                                const currentTriggerConfig = form.getValues('triggerConfig') || {};
                                const updatedTriggerConfig = { ...currentTriggerConfig, [key]: newValue };
                                form.setValue('triggerConfig', updatedTriggerConfig, { shouldDirty: true, shouldValidate: true });
                                console.log(`🔄 Also updated nested triggerConfig:`, updatedTriggerConfig);
                              });
                            }}
                          />
                        ))}
                      </div>
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
                            {loadingEvents ? (
                              <SelectItem key="loading" value="__loading__" disabled>
                                <div className="flex items-center gap-2">
                                  <span>加载中...</span>
                                </div>
                              </SelectItem>
                            ) : (
                              eventPlugins.map((event) => (
                                <SelectItem
                                  key={event.id || `event-${event.eventType}-${event.name}`}
                                  value={event.eventType}
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="truncate">{event.name}</span>
                                    <Badge variant="secondary" className="text-xs">v{event.version}</Badge>
                                  </div>
                                </SelectItem>
                              ))
                            )}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Event Configuration */}
                  {selectedEvent && (selectedEvent.paramsSchema || selectedEvent.configSchema) && (
                    <div className="space-y-4 p-4 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <Settings className="h-4 w-4" />
                        <span className="font-medium text-sm">事件配置</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-3">
                        {/* Use paramsSchema if available, otherwise fall back to configSchema */}
                        {Object.entries((selectedEvent.paramsSchema?.properties || selectedEvent.configSchema?.properties) || {}).map(([key, schema]) => (
                          <Controller
                            key={key}
                            name={`eventConfig.${key}` as any}
                            control={form.control}
                            defaultValue={(schema as any)?.default || ''}
                            render={({ field }) => {
                              console.log(`🎨 Rendering event config field: ${key}, value:`, field.value, 'name:', `eventConfig.${key}`);
                              return renderConfigField(key, schema, field.value, (newValue) => {
                                console.log(`🔄 Event config field ${key} changed from:`, field.value, 'to:', newValue);
                                field.onChange(newValue);

                                // 同时更新嵌套对象，确保数据一致性
                                const currentEventConfig = form.getValues('eventConfig') || {};
                                const updatedEventConfig = { ...currentEventConfig, [key]: newValue };
                                form.setValue('eventConfig', updatedEventConfig, { shouldDirty: true, shouldValidate: true });
                                console.log(`🔄 Also updated nested eventConfig:`, updatedEventConfig);
                              });
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* 表单验证反馈 */}
            <FormValidationFeedback
              formData={form.watch()}
              triggerPlugin={selectedTrigger}
              eventPlugin={selectedEvent}
              isSubmitting={isSaving}
              onValidationChange={setValidationResult}
            />

            <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="sm:w-auto w-full">
                取消
              </Button>
              <Button
                type="submit"
                disabled={isSaving || !validationResult.isValid}
                className={validationResult.warnings.length > 0 ? 'bg-yellow-600 hover:bg-yellow-700 sm:w-auto w-full' : 'sm:w-auto w-full'}
              >
                {isSaving ? '保存中...' : '保存规则'}
                {validationResult.warnings.length > 0 && (
                  <span className="ml-1 text-xs">({validationResult.warnings.length} 警告)</span>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
