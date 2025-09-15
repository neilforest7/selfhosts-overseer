"use client";

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Settings, 
  Zap, 
  Play, 
  Info, 
  CheckCircle, 
  AlertCircle,
  Code,
  Tag
} from 'lucide-react';
import { fetchPlugin, type Plugin } from '@/lib/api/plugins';

interface PluginConfigDialogProps {
  pluginId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (pluginId: string, config: any) => void;
}

export function PluginConfigDialog({
  pluginId,
  open,
  onOpenChange,
  onSave
}: PluginConfigDialogProps) {
  const [config, setConfig] = useState<Record<string, any>>({});

  const { data: plugin, isLoading } = useQuery<Plugin>({
    queryKey: ['plugin', pluginId],
    queryFn: () => fetchPlugin(pluginId!),
    enabled: !!pluginId && open,
  });

  useEffect(() => {
    if (plugin && plugin.configSchema) {
      // Initialize config with default values from schema
      const defaultConfig: Record<string, any> = {};
      Object.entries(plugin.configSchema).forEach(([key, schema]: [string, any]) => {
        if (schema.default !== undefined) {
          defaultConfig[key] = schema.default;
        }
      });
      setConfig(defaultConfig);
    }
  }, [plugin]);

  const handleSave = () => {
    if (pluginId && onSave) {
      onSave(pluginId, config);
    }
    onOpenChange(false);
  };

  const renderConfigField = (key: string, schema: any) => {
    const value = config[key];
    const setValue = (newValue: any) => {
      setConfig(prev => ({ ...prev, [key]: newValue }));
    };

    switch (schema.type) {
      case 'string':
        if (schema.enum) {
          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{schema.title || key}</Label>
              <select
                id={key}
                value={value || ''}
                onChange={(e) => setValue(e.target.value)}
                className="w-full p-2 border rounded-md"
              >
                <option value="">选择...</option>
                {schema.enum.map((option: string) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {schema.description && (
                <p className="text-sm text-muted-foreground">{schema.description}</p>
              )}
            </div>
          );
        }
        
        if (schema.format === 'textarea') {
          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={key}>{schema.title || key}</Label>
              <Textarea
                id={key}
                value={value || ''}
                onChange={(e) => setValue(e.target.value)}
                placeholder={schema.placeholder}
                rows={4}
              />
              {schema.description && (
                <p className="text-sm text-muted-foreground">{schema.description}</p>
              )}
            </div>
          );
        }

        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{schema.title || key}</Label>
            <Input
              id={key}
              type={schema.format === 'password' ? 'password' : 'text'}
              value={value || ''}
              onChange={(e) => setValue(e.target.value)}
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
            <Label htmlFor={key}>{schema.title || key}</Label>
            <Input
              id={key}
              type="number"
              value={value || ''}
              onChange={(e) => setValue(schema.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value))}
              placeholder={schema.placeholder}
              min={schema.minimum}
              max={schema.maximum}
            />
            {schema.description && (
              <p className="text-sm text-muted-foreground">{schema.description}</p>
            )}
          </div>
        );

      case 'boolean':
        return (
          <div key={key} className="flex items-center justify-between space-y-2">
            <div className="space-y-0.5">
              <Label htmlFor={key}>{schema.title || key}</Label>
              {schema.description && (
                <p className="text-sm text-muted-foreground">{schema.description}</p>
              )}
            </div>
            <Switch
              id={key}
              checked={value || false}
              onCheckedChange={setValue}
            />
          </div>
        );

      case 'array':
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{schema.title || key}</Label>
            <Textarea
              id={key}
              value={Array.isArray(value) ? value.join('\n') : ''}
              onChange={(e) => setValue(e.target.value.split('\n').filter(Boolean))}
              placeholder={schema.placeholder || '每行一个值'}
              rows={3}
            />
            {schema.description && (
              <p className="text-sm text-muted-foreground">{schema.description}</p>
            )}
          </div>
        );

      default:
        return (
          <div key={key} className="space-y-2">
            <Label htmlFor={key}>{schema.title || key}</Label>
            <Input
              id={key}
              value={JSON.stringify(value || '')}
              onChange={(e) => {
                try {
                  setValue(JSON.parse(e.target.value));
                } catch {
                  setValue(e.target.value);
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

  const getPluginTypeIcon = (type: string) => {
    if (type.includes('trigger')) return <Zap className="h-5 w-5 text-blue-500" />;
    if (type.includes('event')) return <Play className="h-5 w-5 text-green-500" />;
    return <Settings className="h-5 w-5" />;
  };

  const getPluginTypeBadge = (type: string) => {
    if (type.includes('trigger')) return <Badge variant="outline">触发器</Badge>;
    if (type.includes('event')) return <Badge variant="secondary">事件</Badge>;
    return <Badge variant="default">{type}</Badge>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            插件配置
          </DialogTitle>
          <DialogDescription>
            配置插件的参数和选项
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="text-center py-8">加载中...</div>
        ) : plugin ? (
          <div className="space-y-6">
            {/* Plugin Info */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  {getPluginTypeIcon(plugin.type)}
                  <div className="flex-1">
                    <CardTitle className="text-lg">{plugin.name}</CardTitle>
                    <CardDescription>{plugin.description}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPluginTypeBadge(plugin.type)}
                    <Badge variant="outline">v{plugin.version}</Badge>
                    {plugin.enabled ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {plugin.author && (
                    <div className="flex items-center gap-1">
                      <Info className="h-3 w-3" />
                      作者: {plugin.author}
                    </div>
                  )}
                  {plugin.tags && plugin.tags.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      {plugin.tags.join(', ')}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Configuration */}
            {plugin.configSchema && Object.keys(plugin.configSchema).length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    配置参数
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(plugin.configSchema).map(([key, schema]) =>
                    renderConfigField(key, schema)
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  此插件无需配置参数
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            插件未找到
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!plugin}>
            保存配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
