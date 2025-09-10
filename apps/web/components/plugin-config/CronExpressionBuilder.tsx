"use client";

import { useState, useEffect } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Clock, Calendar, Info } from 'lucide-react';

interface CronExpressionBuilderProps {
  value: string;
  onChange: (expression: string) => void;
}

const CRON_PRESETS = [
  { label: '每分钟', value: '* * * * *', description: '每分钟执行一次' },
  { label: '每5分钟', value: '*/5 * * * *', description: '每5分钟执行一次' },
  { label: '每小时', value: '0 * * * *', description: '每小时的第0分钟执行' },
  { label: '每天上午9点', value: '0 9 * * *', description: '每天上午9:00执行' },
  { label: '每天午夜', value: '0 0 * * *', description: '每天午夜12:00执行' },
  { label: '每周一上午9点', value: '0 9 * * 1', description: '每周一上午9:00执行' },
  { label: '每月1号午夜', value: '0 0 1 * *', description: '每月1号午夜执行' },
  { label: '工作日上午9点', value: '0 9 * * 1-5', description: '周一到周五上午9:00执行' },
];

const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const MONTHS = [
  { value: 1, label: '一月' }, { value: 2, label: '二月' }, { value: 3, label: '三月' },
  { value: 4, label: '四月' }, { value: 5, label: '五月' }, { value: 6, label: '六月' },
  { value: 7, label: '七月' }, { value: 8, label: '八月' }, { value: 9, label: '九月' },
  { value: 10, label: '十月' }, { value: 11, label: '十一月' }, { value: 12, label: '十二月' },
];
const WEEKDAYS = [
  { value: 0, label: '周日' }, { value: 1, label: '周一' }, { value: 2, label: '周二' },
  { value: 3, label: '周三' }, { value: 4, label: '周四' }, { value: 5, label: '周五' },
  { value: 6, label: '周六' },
];

export function CronExpressionBuilder({ value, onChange }: CronExpressionBuilderProps) {
  const [mode, setMode] = useState<'preset' | 'builder' | 'manual'>('preset');
  const [builderValues, setBuilderValues] = useState({
    minute: '*',
    hour: '*',
    day: '*',
    month: '*',
    weekday: '*',
  });

  // Parse existing CRON expression
  useEffect(() => {
    if (value && value.includes(' ')) {
      const parts = value.split(' ');
      if (parts.length >= 5) {
        setBuilderValues({
          minute: parts[0] || '*',
          hour: parts[1] || '*',
          day: parts[2] || '*',
          month: parts[3] || '*',
          weekday: parts[4] || '*',
        });
      }
    }
  }, [value]);

  const buildCronExpression = () => {
    const { minute, hour, day, month, weekday } = builderValues;
    return `${minute} ${hour} ${day} ${month} ${weekday}`;
  };

  const handleBuilderChange = (field: string, newValue: string) => {
    const newValues = { ...builderValues, [field]: newValue };
    setBuilderValues(newValues);
    
    // Build and emit the new expression
    const expression = `${newValues.minute} ${newValues.hour} ${newValues.day} ${newValues.month} ${newValues.weekday}`;
    onChange(expression);
  };

  const getNextExecutionTime = (cronExpression: string) => {
    // This is a simplified preview - in a real app you'd use a CRON library
    try {
      const parts = cronExpression.split(' ');
      if (parts.length < 5) return '无效的CRON表达式';
      
      const [minute, hour, day, month, weekday] = parts;
      
      if (minute === '*' && hour === '*') {
        return '每分钟执行';
      } else if (hour === '*') {
        return `每小时的第${minute}分钟执行`;
      } else if (day === '*' && month === '*' && weekday === '*') {
        return `每天${hour.padStart(2, '0')}:${minute.padStart(2, '0')}执行`;
      }
      
      return '根据CRON表达式执行';
    } catch {
      return '无效的CRON表达式';
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="preset">预设模板</TabsTrigger>
          <TabsTrigger value="builder">可视化构建</TabsTrigger>
          <TabsTrigger value="manual">手动输入</TabsTrigger>
        </TabsList>

        <TabsContent value="preset" className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            {CRON_PRESETS.map((preset) => (
              <Button
                key={preset.value}
                variant={value === preset.value ? "default" : "outline"}
                className="justify-start h-auto p-3"
                onClick={() => onChange(preset.value)}
              >
                <div className="text-left">
                  <div className="font-medium">{preset.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {preset.description} ({preset.value})
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="builder" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>分钟</Label>
              <Select 
                value={builderValues.minute} 
                onValueChange={(v) => handleBuilderChange('minute', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">每分钟 (*)</SelectItem>
                  <SelectItem value="*/5">每5分钟 (*/5)</SelectItem>
                  <SelectItem value="*/10">每10分钟 (*/10)</SelectItem>
                  <SelectItem value="*/15">每15分钟 (*/15)</SelectItem>
                  <SelectItem value="*/30">每30分钟 (*/30)</SelectItem>
                  {MINUTES.map(m => (
                    <SelectItem key={m} value={m.toString()}>
                      第{m}分钟
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>小时</Label>
              <Select 
                value={builderValues.hour} 
                onValueChange={(v) => handleBuilderChange('hour', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">每小时 (*)</SelectItem>
                  {HOURS.map(h => (
                    <SelectItem key={h} value={h.toString()}>
                      {h.toString().padStart(2, '0')}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>日期</Label>
              <Select 
                value={builderValues.day} 
                onValueChange={(v) => handleBuilderChange('day', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">每天 (*)</SelectItem>
                  {DAYS.map(d => (
                    <SelectItem key={d} value={d.toString()}>
                      {d}号
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>月份</Label>
              <Select 
                value={builderValues.month} 
                onValueChange={(v) => handleBuilderChange('month', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">每月 (*)</SelectItem>
                  {MONTHS.map(m => (
                    <SelectItem key={m.value} value={m.value.toString()}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 col-span-2">
              <Label>星期</Label>
              <Select 
                value={builderValues.weekday} 
                onValueChange={(v) => handleBuilderChange('weekday', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="*">每天 (*)</SelectItem>
                  <SelectItem value="1-5">工作日 (1-5)</SelectItem>
                  <SelectItem value="0,6">周末 (0,6)</SelectItem>
                  {WEEKDAYS.map(w => (
                    <SelectItem key={w.value} value={w.value.toString()}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="manual" className="space-y-3">
          <div className="space-y-2">
            <Label>CRON表达式</Label>
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="* * * * *"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              格式: 分钟 小时 日期 月份 星期 (例如: 0 9 * * * 表示每天上午9点)
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Preview */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4" />
            执行预览
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {value || '* * * * *'}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {getNextExecutionTime(value || '* * * * *')}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
