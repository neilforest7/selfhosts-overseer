"use client";

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { 
  MoreHorizontal, 
  RefreshCw, 
  Settings, 
  Trash2, 
  Plus,
  Zap,
  Play,
  Info,
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchPlugins,
  fetchPluginSummary,
  fetchTriggerPlugins,
  fetchEventPlugins,
  setPluginEnabled,
  reloadPlugin,
  type Plugin,
  type PluginSummary,
  type TriggerPlugin,
  type EventPlugin
} from '@/lib/api/plugins';
import { PluginConfigDialog } from './PluginConfigDialog';

export default function PluginsSection() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

  // Queries
  const { data: summary, isLoading: summaryLoading } = useQuery<PluginSummary>({
    queryKey: ['pluginSummary'],
    queryFn: fetchPluginSummary,
  });

  const { data: plugins = [], isLoading: pluginsLoading } = useQuery<Plugin[]>({
    queryKey: ['plugins'],
    queryFn: fetchPlugins,
  });

  const { data: triggerPlugins = [], isLoading: triggersLoading } = useQuery<TriggerPlugin[]>({
    queryKey: ['triggerPlugins'],
    queryFn: fetchTriggerPlugins,
  });

  const { data: eventPlugins = [], isLoading: eventsLoading } = useQuery<EventPlugin[]>({
    queryKey: ['eventPlugins'],
    queryFn: fetchEventPlugins,
  });

  // Mutations
  const enableMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => 
      setPluginEnabled(id, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['pluginSummary'] });
      queryClient.invalidateQueries({ queryKey: ['triggerPlugins'] });
      queryClient.invalidateQueries({ queryKey: ['eventPlugins'] });
      toast.success('插件状态更新成功');
    },
    onError: (error: Error) => {
      toast.error('更新插件状态失败', { description: error.message });
    },
  });

  const reloadMutation = useMutation({
    mutationFn: reloadPlugin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      toast.success('插件重载成功');
    },
    onError: (error: Error) => {
      toast.error('重载插件失败', { description: error.message });
    },
  });

  const handleToggleEnabled = (plugin: Plugin) => {
    enableMutation.mutate({ id: plugin.id, enabled: !plugin.enabled });
  };

  const handleReload = (plugin: Plugin) => {
    reloadMutation.mutate(plugin.id);
  };

  const handleConfigure = (plugin: Plugin) => {
    setSelectedPluginId(plugin.id);
    setConfigDialogOpen(true);
  };

  const handleSaveConfig = (pluginId: string, config: any) => {
    // TODO: Implement plugin configuration save API
    console.log('Saving plugin config:', pluginId, config);
    toast.success('插件配置已保存');
  };

  const getPluginTypeIcon = (type: string) => {
    if (type.includes('trigger')) return <Zap className="h-4 w-4" />;
    if (type.includes('event')) return <Play className="h-4 w-4" />;
    return <Settings className="h-4 w-4" />;
  };

  const getPluginTypeBadge = (type: string) => {
    if (type.includes('trigger')) return <Badge variant="outline">触发器</Badge>;
    if (type.includes('event')) return <Badge variant="secondary">事件</Badge>;
    return <Badge variant="default">{type}</Badge>;
  };

  const renderPluginTable = (pluginList: Plugin[], showType = true) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>插件</TableHead>
          {showType && <TableHead>类型</TableHead>}
          <TableHead>版本</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pluginList.map((plugin) => (
          <TableRow key={plugin.id}>
            <TableCell>
              <div className="flex items-center gap-2">
                {getPluginTypeIcon(plugin.type)}
                <div>
                  <div className="font-medium">{plugin.name}</div>
                  <div className="text-sm text-muted-foreground">{plugin.description}</div>
                  {plugin.author && (
                    <div className="text-xs text-muted-foreground">作者: {plugin.author}</div>
                  )}
                </div>
              </div>
            </TableCell>
            {showType && (
              <TableCell>
                {getPluginTypeBadge(plugin.type)}
              </TableCell>
            )}
            <TableCell>
              <Badge variant="outline">{plugin.version}</Badge>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Switch
                  checked={plugin.enabled}
                  onCheckedChange={() => handleToggleEnabled(plugin)}
                  disabled={enableMutation.isPending}
                />
                {plugin.enabled ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-gray-400" />
                )}
              </div>
            </TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleConfigure(plugin)}>
                    <Settings className="h-4 w-4 mr-2" />
                    配置插件
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleReload(plugin)}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    重载插件
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Info className="h-4 w-4 mr-2" />
                    查看详情
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="space-y-6">

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm text-muted-foreground">总计</div>
              </div>
              <div className="text-2xl font-bold">{summary.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-500" />
                <div className="text-sm text-muted-foreground">触发器</div>
              </div>
              <div className="text-2xl font-bold">{summary.triggers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 text-green-500" />
                <div className="text-sm text-muted-foreground">事件</div>
              </div>
              <div className="text-2xl font-bold">{summary.events}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <div className="text-sm text-muted-foreground">已启用</div>
              </div>
              <div className="text-2xl font-bold">{summary.enabled}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-gray-400" />
                <div className="text-sm text-muted-foreground">已禁用</div>
              </div>
              <div className="text-2xl font-bold">{summary.disabled}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Plugin Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className='flex flex-row items-center justify-between pb-2'>
          <TabsList>
            <TabsTrigger value="overview">全部插件</TabsTrigger>
            <TabsTrigger value="triggers">触发器</TabsTrigger>
            <TabsTrigger value="events">事件</TabsTrigger>
          </TabsList>
          <Button size="sm" >
            <Plus className="h-4 w-4 mr-2"/>
            安装插件
          </Button>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>所有插件</CardTitle>
            </CardHeader>
            <CardContent>
              {pluginsLoading ? (
                <div className="text-center py-8">加载中...</div>
              ) : plugins.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无插件
                </div>
              ) : (
                renderPluginTable(plugins)
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="triggers" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>触发器插件</CardTitle>
            </CardHeader>
            <CardContent>
              {triggersLoading ? (
                <div className="text-center py-8">加载中...</div>
              ) : triggerPlugins.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无触发器插件
                </div>
              ) : (
                renderPluginTable(triggerPlugins, false)
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>事件插件</CardTitle>
            </CardHeader>
            <CardContent>
              {eventsLoading ? (
                <div className="text-center py-8">加载中...</div>
              ) : eventPlugins.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  暂无事件插件
                </div>
              ) : (
                renderPluginTable(eventPlugins, false)
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Plugin Configuration Dialog */}
      <PluginConfigDialog
        pluginId={selectedPluginId}
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        onSave={handleSaveConfig}
      />
    </div>
  );
}
