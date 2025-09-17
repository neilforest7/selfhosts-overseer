"use client";

import { useMemo, useState, Fragment, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ManualPortDialog } from './ManualPortDialog';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';
import { DiscoverHostsDialog } from './DiscoverHostsDialog';
import { apiClient, ApiResponse } from '@/src/lib/api-client';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { getUpdateStatusDisplay, ImageUpdateStatus } from '@/src/shared';
import { 
  ContainerStatusIndicator,
  ContainerPartialStatusIndicator 
} from '@/components/ContainerStatusIndicator';
import { cn } from '@/lib/utils';
import { IconDotsVertical } from '@tabler/icons-react';


type ContainerItem = {
  id: string;
  name: string;
  state?: string;
  status?: string;
  imageName?: string;
  imageTag?: string;
  repoDigest?: string | null;
  remoteDigest?: string | null;
  updateAvailable?: boolean; // 保留向后兼容
  // 新的镜像状态字段
  containerImageDigest?: string | null;
  localImageDigest?: string | null;
  imageUpdateStatus?: ImageUpdateStatus;
  updateCheckedAt?: string | null;
  restartCount?: number | null;
  isComposeManaged?: boolean;
  composeProject?: string | null;
  composeService?: string | null;
  composeWorkingDir?: string | null;
  composeFolderName?: string | null;
  manualPortMapping?: { exposedPort: string; internalPort: string } | null;
  hostId: string;
  composeProjectId?: string;
  updatedAt?: string | Date;
};

type HostItem = {
  id: string;
  name: string;
  address: string;
  sshUser: string;
  tags?: string[];
};

export default function ContainersSection() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [updateOnly, setUpdateOnly] = useState(false);
  const [hostFilter, setHostFilter] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'compose' | 'cli'>('all');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [discoverDialogOpen, setDiscoverDialogOpen] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const { startOperation, fetchTasks, selectTask, setOpen, addTaskAndOpen } = useTaskDrawerStore((s) => s.actions);

  // Helper function to execute task operations and automatically open TaskDrawer
  const executeTaskOperation = useCallback(async (
    title: string,
    apiCall: () => Promise<ApiResponse>,
    onSuccess?: (result: any) => void,
    onError?: (error: Error) => void
  ) => {
    try {
      const response = await apiCall();
      if (!response.success) {
        throw new Error(response.error || '操作失败');
      }
      const result = response.data as { taskId?: string };

      // If the API returns a taskId, add it to TaskDrawer and select it
      if (result?.taskId) {
        // Create a temporary task entry for immediate display
        const tempTask = {
          id: result.taskId!,
          title,
          status: 'RUNNING' as const,
          triggerType: 'MANUAL' as const,
          startTime: new Date().toISOString(),
          endTime: null,
          entries: []
        };
        addTaskAndOpen(tempTask);

        // Monitor the task status
        const monitorTask = async () => {
          try {
            const statusResponse = await apiClient.get(`/api/v1/operations/${result.taskId!}`);
            if (statusResponse.success) {
              const taskData = statusResponse.data as { status: string };
              if (taskData?.status === 'COMPLETED') {
                // Task completed successfully
                toast.success(`操作成功: ${title}`);
                if (onSuccess) onSuccess(result);
                return; // Task finished, stop monitoring
              } else if (taskData?.status === 'ERROR') {
                // Task failed
                toast.error(`操作失败: ${title}`);
                if (onError) onError(new Error(`Task failed with status: ERROR`));
                return; // Task finished, stop monitoring
              }
            }
            // Continue monitoring every 2 seconds
            setTimeout(monitorTask, 2000);
          } catch (error) {
            console.error('Failed to monitor task status:', error);
          }
        };
        monitorTask();

        // Show "operation started" notification for long-running tasks
        toast.info(`操作已开始: ${title}，正在处理中...`);
      } else {
        // No taskId, immediate execution
        toast.success(`操作成功: ${title}`);
        if (onSuccess) onSuccess(result);
      }
    } catch (error) {
      console.error(`Task operation failed: ${title}`, error);
      if (onError) onError(error as Error);
      toast.error(`操作失败: ${title}`);
    }
  }, [addTaskAndOpen]);

  // Helper function to refresh containers with debouncing
  const refreshContainers = useCallback(async (immediate = true) => {
    try {
      if (immediate) {
        await qc.invalidateQueries({
          queryKey: ['containers'],
          exact: false
        });
      }
      // Single delayed refresh instead of multiple timeouts
      setTimeout(() => {
        qc.invalidateQueries({
          queryKey: ['containers'],
          exact: false
        });
      }, 2000);
    } catch (error) {
      console.error('Failed to refresh containers:', error);
    }
  }, [qc]);

  // Helper function to monitor operation status
  const monitorOperationStatus = async (taskId: string, operationName: string = '操作'): Promise<void> => {
    const maxAttempts = 30; // Maximum 30 attempts (30 seconds)
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const response = await apiClient.get(`/api/v1/operations/${taskId}`);
        if (!response.success) break;

        const operation = response.data as { status: string };

        if (operation?.status === 'COMPLETED') {
          toast.success(`${operationName}完成`);
          await refreshContainers(true);
          return;
        } else if (operation?.status === 'ERROR') {
          toast.error(`${operationName}失败`);
          return;
        }

        // Wait 1 second before next check
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      } catch (error) {
        console.error('Failed to check operation status:', error);
        break;
      }
    }

    // If we reach here, either max attempts reached or error occurred
    toast.warning(`${operationName}超时，请手动检查结果`);
    await refreshContainers(true);
  };

  // Mutation for triggering actual container status refresh operation
  const refreshStatusMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/api/v1/containers/refresh-status', { host: { id: 'all' } });
      if (!response.success) {
        throw new Error(`刷新失败: ${response.error}`);
      }
      return response.data;
    },
    onSuccess: async (data: any) => {
      toast.success('容器状态刷新已启动');
      // Monitor the operation status and refresh UI when complete
      if (data?.taskId) {
        await monitorOperationStatus(data.taskId);
      } else {
        // Fallback: refresh after a delay
        setTimeout(async () => {
          await refreshContainers(true);
          toast.success('容器状态已更新');
        }, 3000);
      }
    },
    onError: (error: any) => {
      console.error('Container status refresh failed:', error);
      toast.error(`容器状态刷新失败: ${error.message}`);
    },
  });

  const listQuery = useQuery<{ items: ContainerItem[] }>({
    queryKey: ['containers', q, updateOnly, hostFilter, filterMode],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (updateOnly) params.set('updateAvailable', 'true');
      if (hostFilter) params.set('hostName', hostFilter);
      if (filterMode === 'compose') {
        params.set('composeManaged', 'true');
      } else if (filterMode === 'cli') {
        params.set('composeManaged', 'false');
      }
      
      const response = await apiClient.get<{ items: ContainerItem[] }>(`/api/v1/containers?${params.toString()}`);
      if (!response.success) throw new Error(response.error || '加载失败');
      return response.data as { items: ContainerItem[] };
    },
    refetchInterval: 30000, // 减少到30秒自动刷新，避免竞态条件
    refetchIntervalInBackground: false, // 页面在后台时停止刷新，减少竞态条件
  });

  const hostsQuery = useQuery<{ items: HostItem[] }>({ 
    queryKey: ['hosts'],
    queryFn: async () => {
      const response = await apiClient.get<{ items: HostItem[] }>('/api/v1/hosts');
      if (!response.success) throw new Error(response.error || '加载主机失败');
      return response.data as { items: HostItem[] };
    }
  });

  // 主机颜色映射 - 使用更多样化的颜色
  const getHostBadgeColor = useMemo(() => {
    const colors = [
      'border-slate-600 text-slate-600 bg-slate-100',     // 灰色
      'border-sky-600 text-sky-600 bg-sky-100',   // 浅灰色
      // 'border-cyan-600 text-', // 红色
      'border-teal-600 text-teal-600 bg-teal-100',     // 边框样式
      'border-emerald-600 text-emerald-600 bg-emerald-100',
      // 'border-green-600 text-green-600',
      // 'border-lime-600 text-',
      'border-yellow-600 text-yellow-600 bg-yellow-100',
      'border-amber-600 text-amber-600 bg-amber-100',
      'border-orange-600 text-orange-600 bg-orange-100',
      'border-red-600 text-red-600 bg-red-100',
    ] as const;
    const hostIds = hostsQuery.data?.items?.map(h => h.id) || [];
    const colorMap = new Map<string, typeof colors[number]>();
    hostIds.forEach((hostId, index) => {
      colorMap.set(hostId, colors[index % colors.length]);
    });
    return (hostId: string) => colorMap.get(hostId) || 'default';
  }, [hostsQuery.data]);

  const getHostName = useMemo(() => {
    const hostMap = new Map(hostsQuery.data?.items?.map(h => [h.id, h.name]) || []);
    return (hostId: string) => hostMap.get(hostId) || hostId.slice(0, 8);
  }, [hostsQuery.data]);

  // 获取镜像更新状态的显示信息 - 返回彩色点而不是徽章
  const getImageUpdateDot = (imageUpdateStatus?: string, updateAvailable?: boolean) => {
    // 如果有新的状态字段，使用新的逻辑
    if (imageUpdateStatus && imageUpdateStatus !== 'UNKNOWN') {
      const display = getUpdateStatusDisplay(imageUpdateStatus as ImageUpdateStatus);
      return {
        color: display.color === 'green' ? 'bg-green-500' :
              display.color === 'orange' ? 'bg-orange-500' :
              display.color === 'blue' ? 'bg-blue-500' :
              display.color === 'red' ? 'bg-red-500' :
              display.color === 'purple-400' ? 'bg-purple-400' :
              display.color === 'pink-400' ? 'bg-pink-400' :
              display.color === 'indigo-400' ? 'bg-indigo-400' :
              'bg-gray-500',
        description: display.description,
        action: display.action,
      };
    }

    // 回退到旧的逻辑（向后兼容）
    if (updateAvailable) {
      return {
        color: 'bg-amber-500',
        description: '有更新可用',
        action: 'update' as const,
      };
    }

    return null;
  };

  
  const discover = useMutation({
    mutationFn: async (hostTarget: string | 'all' | string[]) => {
      let body: any;

      if (Array.isArray(hostTarget)) {
        // Multiple hosts
        body = { hostIds: hostTarget };
      } else if (hostTarget === 'all') {
        // All hosts
        body = {};
      } else {
        // Single host
        body = { host: { id: hostTarget } };
      }

      const response = await apiClient.post('/api/v1/containers/discover', body);
      if (!response.success) throw new Error(response.error || '发现失败');
      return response.data;
    },
    onMutate: (hostTarget) => {
      let hostName: string;

      if (Array.isArray(hostTarget)) {
        const hostNames = hostTarget.map(id =>
          hostsQuery.data?.items?.find(h => h.id === id)?.name || id
        );
        hostName = `${hostNames.slice(0, 2).join(', ')}${hostNames.length > 2 ? ` 等 ${hostNames.length} 台主机` : ''}`;
      } else if (hostTarget === 'all') {
        hostName = '全部主机';
      } else {
        hostName = hostsQuery.data?.items?.find(h => h.id === hostTarget)?.name || hostTarget;
      }

      toast.info(`开始容器发现：${hostName}`);
    },
    onSuccess: async (data: any, variables) => {
      let hostName: string;
      if (Array.isArray(variables)) {
        const hostNames = variables.map(id =>
          hostsQuery.data?.items?.find(h => h.id === id)?.name || id
        );
        hostName = `${hostNames.slice(0, 2).join(', ')}${hostNames.length > 2 ? ` 等 ${hostNames.length} 台主机` : ''}`;
      } else if (variables === 'all') {
        hostName = '全部主机';
      } else {
        hostName = hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables;
      }

      if (data.taskId) {
        await fetchTasks();
        selectTask(data.taskId);
        setOpen(true);
        // Monitor the operation completion
        await monitorOperationStatus(data.taskId, `容器发现（${hostName}）`);
      } else {
        // Fallback for operations that don't return taskId
        if (typeof data?.upserted === 'number') {
          toast.success(`发现完成（${hostName}）：新增/更新 ${data.upserted} 个`);
        } else {
          toast.success(`发现完成（${hostName}）`);
        }
        await refreshContainers(true);
      }
    },
    onError: (err: any, variables) => {
      let hostName: string;
      if (Array.isArray(variables)) {
        const hostNames = variables.map(id =>
          hostsQuery.data?.items?.find(h => h.id === id)?.name || id
        );
        hostName = `${hostNames.slice(0, 2).join(', ')}${hostNames.length > 2 ? ` 等 ${hostNames.length} 台主机` : ''}`;
      } else if (variables === 'all') {
        hostName = '全部主机';
      } else {
        hostName = hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables;
      }
      toast.error(`发现失败（${hostName}）：${err?.message || '未知错误'}`);
    }
  });

  const checkUpdates = useMutation({
    mutationFn: async (hostTarget: string | 'all') => {
      const body = hostTarget === 'all' ? {} : { host: { id: hostTarget } };
      const response = await apiClient.post('/api/v1/containers/check-updates', body);
      if (!response.success) throw new Error(response.error || '检查失败');
      return response.data;
    },
    onMutate: (hostTarget) => {
      const hostName = hostTarget === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === hostTarget)?.name || hostTarget);
      toast.info(`开始检查镜像更新：${hostName}`);
    },
    onSuccess: async (data: any, variables) => {
      const hostName = variables === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables);
      if (data.taskId) {
        await fetchTasks();
        selectTask(data.taskId);
        setOpen(true);
        // Monitor the operation completion
        await monitorOperationStatus(data.taskId, `检查镜像更新（${hostName}）`);
      } else {
        // Fallback for operations that don't return taskId
        if (typeof data?.updated === 'number') {
          toast.success(`检查完成（${hostName}）：可更新 ${data.updated} 个`);
        } else {
          toast.success(`检查完成（${hostName}）`);
        }
        await refreshContainers(true);
      }
    },
    onError: (err: any, variables) => {
      const hostName = variables === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables);
      toast.error(`检查失败（${hostName}）：${err?.message || '未知错误'}`);
    }
  });

  // Compose 操作（改为直接调用后端 compose/operate 接口）
  const composeOperation = useMutation({
    mutationFn: async ({ hostId, project, workingDir, operation }: { hostId: string; project: string; workingDir: string; operation: 'down' | 'pull' | 'up' | 'restart' | 'start' | 'stop' }) => {
      const response = await apiClient.post('/api/v1/containers/compose/operate', {
        hostId, project, workingDir, op: operation
      });
      if (!response.success) throw new Error(`${operation} 操作失败`);
      return response.data;
    },
    onMutate: ({ project, operation }) => {
      toast.info(`正在执行 Compose ${operation}：${project}`);
    },
    onSuccess: async (data: any, { project, operation }) => {
      if (data.taskId) {
        await fetchTasks();
        selectTask(data.taskId);
        setOpen(true);
        // Monitor the operation completion
        await monitorOperationStatus(data.taskId, `Compose ${operation} ${project}`);
      } else {
        // Fallback for operations that don't return taskId
        toast.success(`Compose ${operation} 完成：${project}`);
        await refreshContainers(true);
      }
    },
    onError: (err: any, { project, operation }) => {
      toast.error(`Compose ${operation} 失败：${project} - ${err?.message || '未知错误'}`);
    }
  });

  const analyzeNpm = useMutation({
    mutationFn: async (hostId: string) => {
      const response = await apiClient.post(`/api/v1/reverse-proxy/sync/${hostId}`);
      if (!response.success) throw new Error('分析请求失败');
      return response.data;
    },
    onMutate: (hostId) => {
      const hostName = hostsQuery.data?.items?.find(h => h.id === hostId)?.name || hostId;
      toast.info(`开始分析 ${hostName} 上的 NPM...`);
    },
    onSuccess: (_data, hostId) => {
      const hostName = hostsQuery.data?.items?.find(h => h.id === hostId)?.name || hostId;
      toast.success(`NPM 分析完成：${hostName}`);
      qc.invalidateQueries({ queryKey: ['reverse-proxy-routes'] }); // Assuming this is the query key for routes
    },
    onError: (err: any, hostId) => {
      const hostName = hostsQuery.data?.items?.find(h => h.id === hostId)?.name || hostId;
      toast.error(`NPM 分析失败：${hostName} - ${err?.message || '未知错误'}`);
    }
  });

  const analyzeFrp = useMutation({
    mutationFn: async (hostId: string) => {
      const response = await apiClient.post(`/api/v1/frp/sync/${hostId}`);
      if (!response.success) throw new Error('分析请求失败');
      return response.data;
    },
    onMutate: (hostId) => {
      const hostName = hostsQuery.data?.items?.find(h => h.id === hostId)?.name || hostId;
      toast.info(`开始分析 ${hostName} 上的 FRP...`);
    },
    onSuccess: (_data, hostId) => {
      const hostName = hostsQuery.data?.items?.find(h => h.id === hostId)?.name || hostId;
      toast.success(`FRP 分析完成：${hostName}`);
    },
    onError: (err: any, hostId) => {
      const hostName = hostsQuery.data?.items?.find(h => h.id === hostId)?.name || hostId;
      toast.error(`FRP 分析失败：${hostName} - ${err?.message || '未知错误'}`);
    }
  });

  

  return (
    <Card>
      <CardHeader className='flex-row align-middle items-center gap-2 '>
        <CardTitle className='flex-1'>
          容器
          {/* {listQuery.isFetching && (
            <span className="ml-2 text-sm text-muted-foreground">
              (刷新中...)
            </span>
          )} */}
        </CardTitle>
        <div className="flex">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              if (refreshStatusMutation.isPending || isManualRefreshing || listQuery.isFetching) return;

              setIsManualRefreshing(true);
              try {
                toast.info('正在刷新容器状态...');
                // First trigger the actual container status refresh operation
                await refreshStatusMutation.mutateAsync();
                // The mutation's onSuccess handler will refresh the UI after the operation completes
              } catch (error) {
                console.error('Failed to refresh containers:', error);
                toast.error('刷新失败，请重试');
              } finally {
                setIsManualRefreshing(false);
              }
            }}
            disabled={listQuery.isFetching || isManualRefreshing || refreshStatusMutation.isPending}
            className="rounded-r-none px-4"
          >
            {(listQuery.isFetching || isManualRefreshing || refreshStatusMutation.isPending) ? '刷新中...' : '刷新'}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="rounded-l-none border-l-0 px-2"
                disabled={listQuery.isFetching || isManualRefreshing || refreshStatusMutation.isPending}
              >
                <ChevronDown/>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={async () => {
                  if (listQuery.isFetching || isManualRefreshing) return;
                  setIsManualRefreshing(true);
                  try {
                    toast.info('正在刷新显示数据...');
                    await qc.invalidateQueries({
                      queryKey: ['containers'],
                      exact: false
                    });
                    toast.success('显示数据已刷新');
                  } catch (error) {
                    console.error('Failed to refresh display:', error);
                    toast.error('刷新显示失败');
                  } finally {
                    setTimeout(() => setIsManualRefreshing(false), 500);
                  }
                }}
              >
                仅刷新UI
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Button size="sm" onClick={() => setDiscoverDialogOpen(true)}>
          发现容器
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm">检查更新</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => checkUpdates.mutate('all')}>
              全部主机
            </DropdownMenuItem>
            {hostsQuery.data?.items?.map(host => (
              <DropdownMenuItem key={host.id} onClick={() => checkUpdates.mutate(host.id)}>
                {host.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={hostFilter || "all"} onValueChange={(value) => setHostFilter(value === "all" ? "" : value)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="选择主机" />
            </SelectTrigger>
            <SelectContent align="start" className="bg-background text-foreground">
              <SelectItem value="all">全部主机</SelectItem>
              {hostsQuery.data?.items?.map(host => (
                <SelectItem key={host.id} value={host.name}>
                  {host.name} ({host.address})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          
          
          <div className="ml-auto flex gap-2">
            <Button variant={updateOnly ? 'default' : 'ghost'} onClick={() => setUpdateOnly(v => !v)}>仅看可更新</Button>
            <Select value={filterMode} onValueChange={(value) => setFilterMode(value as 'all' | 'compose' | 'cli')}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="筛选容器" />
              </SelectTrigger>
              <SelectContent align="start" className="bg-background text-foreground">
                <SelectItem value="all">显示全部</SelectItem>
                <SelectItem value="compose">仅 Compose</SelectItem>
                <SelectItem value="cli">仅 CLI</SelectItem>
              </SelectContent>
            </Select>
            <Input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="搜索容器/镜像" className="min-w-md"/>
            {/* <Button variant={updateOnly ? 'secondary' : 'default'} onClick={()=>setUpdateOnly(v=>!v)}>{updateOnly ? '显示全部' : '仅看可更新'}</Button> */}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>主机</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Object.entries(
              (() => {
                const allItems = listQuery.data?.items || [];
                let filteredItems = allItems;
                
                // 如果有搜索词，进行智能搜索
                if (q.trim()) {
                  const searchTerm = q.toLowerCase();
                  const matchedItems = new Set<ContainerItem>();
                  
                  for (const item of allItems) {
                    // 直接匹配的容器
                    if (item.name.toLowerCase().includes(searchTerm) || 
                        item.imageName?.toLowerCase().includes(searchTerm)) {
                      matchedItems.add(item);
                      
                      // 如果是compose容器，添加同组的所有容器
                      if (item.isComposeManaged && item.composeProject) {
                        for (const sibling of allItems) {
                          if (sibling.hostId === item.hostId && 
                              sibling.composeProject === item.composeProject && 
                              sibling.isComposeManaged) {
                            matchedItems.add(sibling);
                          }
                        }
                      }
                    }
                  }
                  filteredItems = Array.from(matchedItems);
                }
                
                return filteredItems.reduce((acc, item) => {
                  const composeKey = item.isComposeManaged ? (item.composeProject || 'unknown') : `CLI::{${item.name}}`;
                  const groupKey = `${item.hostId}::${composeKey}`;
                  (acc[groupKey] ||= []).push(item);
                  return acc;
                }, {} as Record<string, ContainerItem[]>);
              })()
            ).map(([key, items]) => {
              const first = items[0];
              const isCompose = Boolean(first.isComposeManaged);
              const folderBase = (() => {
                const wd = first.composeWorkingDir || '';
                const parts = wd.split(/[/\\]+/).filter(Boolean);
                if (parts.length) return parts[parts.length - 1];
                return first.composeFolderName || first.composeProject || first.name;
              })();
              const title = isCompose ? (folderBase || first.composeProject || 'compose') : first.name;
              
              // 计算组的综合状态（含部分运行判定）- 支持新的容器生命周期状态
              const getGroupStatus = () => {
                // 状态优先级：removed > error > restarting > starting > running > paused > compose-down > stopped > created > unknown
                const priorities = {
                  removed: 9,
                  error: 8, failed: 8,
                  restarting: 7,
                  starting: 6,
                  running: 5, up: 5,
                  paused: 4,
                  'compose-down': 3,
                  stopped: 3, exited: 3,
                  created: 2,
                  unknown: 1
                } as const;

                let highestPriority = 0;
                let bestStatus = { state: 'unknown', status: '' };
                let runningCount = 0;
                let stoppedCount = 0;
                let removedCount = 0;
                let composeDownCount = 0;

                for (const item of items) {
                  const stateLower = (item.state || '').toLowerCase();
                  const statusLower = (item.status || '').toLowerCase();

                  // 统计不同状态的容器数量
                  const isRunning = stateLower.includes('running') || statusLower.includes('up');
                  const isStopped = stateLower.includes('exited') || stateLower.includes('stopped') || statusLower.includes('exited') || statusLower.includes('stopped');
                  const isRemoved = stateLower === 'removed';
                  const isComposeDown = stateLower === 'compose-down';

                  if (isRunning) runningCount++;
                  else if (isStopped) stoppedCount++;
                  else if (isRemoved) removedCount++;
                  else if (isComposeDown) composeDownCount++;

                  // 查找最高优先级状态
                  for (const [key, priority] of Object.entries(priorities)) {
                    if ((stateLower.includes(key) || statusLower.includes(key) || stateLower === key) && priority > highestPriority) {
                      highestPriority = priority;
                      bestStatus = { state: item.state || '', status: item.status || '' };
                    }
                  }
                }
                const totalCount = items.length;
                // 改进的部分运行检测：只要有运行的容器且有非运行的容器就算部分运行
                const nonRunningCount = stoppedCount + removedCount + composeDownCount;
                const partial = runningCount > 0 && nonRunningCount > 0;
                return {
                  ...bestStatus,
                  meta: {
                    totalCount,
                    runningCount,
                    stoppedCount,
                    removedCount,
                    composeDownCount,
                    partial,
                    anyRunning: runningCount > 0,
                    anyStopped: stoppedCount > 0,
                    anyRemoved: removedCount > 0,
                    anyComposeDown: composeDownCount > 0
                  }
                } as const;
              };
              
              const groupStatus = getGroupStatus();
              
              return (
                <Fragment key={key}> 
                  <TableRow>
                    <TableCell>
                      <Badge className={cn("justify-center", getHostBadgeColor(first.hostId))} variant={'outline'}>
                        <div className='leading-none py-1'>
                          {getHostName(first.hostId)}
                        </div>
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {(groupStatus as any).meta?.partial ? (
                        <ContainerPartialStatusIndicator
                          total={items.length}
                          running={(groupStatus as any).meta?.runningCount || 0}
                        />
                      ) : (
                        <ContainerStatusIndicator
                          state={groupStatus.state}
                          status={groupStatus.status}
                          isComposeManaged={isCompose}
                          containerName={title}
                          hostName={first.hostId}
                          variant="compact"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            {title}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* <span className="text-xs text-muted-foreground">{isCompose ? `${items.length} 个服务` : ''}</span> */}
                          {(() => {
                            // 检查组或容器是否有更新可用 - 使用新的状态逻辑
                            const updateStatuses = items.map(item => ({
                              imageUpdateStatus: item.imageUpdateStatus,
                              updateAvailable: item.updateAvailable
                            }));

                            // 收集所有非 UP_TO_DATE 状态的点
                            const statusDots = updateStatuses
                              .map(s => getImageUpdateDot(s.imageUpdateStatus, s.updateAvailable))
                              .filter(dot => dot !== null);

                            if (statusDots.length > 0) {
                              return (
                                <div className="flex items-center gap-1 ml-2">
                                  {statusDots.map((dot, index) => (
                                    <div
                                      key={index}
                                      className={`w-2 h-2 rounded-full ${dot.color}`}
                                      title={dot.description}
                                    />
                                  ))}
                                </div>
                              );
                            }

                            return null;
                          })()}
                          <Button 
                            className='data-[state=open]:bg-muted text-muted-foreground flex size-8'
                            variant="ghost" 
                            size="icon"
                            onClick={() => setExpandedGroup(expandedGroup === key ? null : key)}
                          >
                            {expandedGroup === key ? <ChevronsDownUp /> : <ChevronsUpDown />}
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isCompose ? (
                        <span>
                          <Badge variant="outline">
                            <div className='leading-none py-1'>
                                compose
                            </div>
                          </Badge>
                        </span>
                      ) : (
                        <span>
                            <Badge variant="outline">
                              <div className='leading-none py-1'>
                                cli
                              </div>
                          </Badge>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="data-[state=open]:bg-muted text-muted-foreground flex size-8" size="icon">
                            <IconDotsVertical />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="max-w-48 bg-background">
                        {isCompose ? (
                          <>
                            <DropdownMenuItem onClick={() => {
                              const workingDir = first.composeWorkingDir || `/path/to/${first.composeProject}`;
                              composeOperation.mutate({
                                hostId: first.hostId, 
                                project: first.composeProject || 'unknown', 
                                workingDir,
                                operation: 'restart' 
                              });
                            }}>重启服务 (restart)</DropdownMenuItem>
                            {(() => {
                              const s = (groupStatus.state || '').toLowerCase();
                              const ss = (groupStatus.status || '').toLowerCase();
                              const running = s.includes('running') || ss.includes('up');
                              const partial = Boolean((groupStatus as any).meta?.partial);
                              const workingDir = first.composeWorkingDir || `/path/to/${first.composeProject}`;
                              return (
                                <>
                                  {(!running || partial) && (
                                    <DropdownMenuItem onClick={() => {
                                      composeOperation.mutate({ hostId: first.hostId, project: first.composeProject || 'unknown', workingDir, operation: 'start' });
                                    }}>启动服务 (start)</DropdownMenuItem>
                                  )}
                                  {(running || partial) && (
                                    <DropdownMenuItem onClick={() => {
                                      composeOperation.mutate({ hostId: first.hostId, project: first.composeProject || 'unknown', workingDir, operation: 'stop' });
                                    }}>停止服务 (stop)</DropdownMenuItem>
                                  )}
                                </>
                              );
                            })()}
                            <DropdownMenuItem onClick={() => {
                              const workingDir = first.composeWorkingDir || `/path/to/${first.composeProject}`;
                              composeOperation.mutate({
                                hostId: first.hostId, 
                                project: first.composeProject || 'unknown', 
                                workingDir,
                                operation: 'down' 
                              });
                            }}>下线 (down)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              const workingDir = first.composeWorkingDir || `/path/to/${first.composeProject}`;
                              composeOperation.mutate({
                                hostId: first.hostId, 
                                project: first.composeProject || 'unknown', 
                                workingDir,
                                operation: 'up' 
                              });
                            }}>上线 (up)</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              const workingDir = first.composeWorkingDir || `/path/to/${first.composeProject}`;
                              composeOperation.mutate({
                                hostId: first.hostId, 
                                project: first.composeProject || 'unknown', 
                                workingDir,
                                operation: 'pull' 
                              });
                            }}>拉取镜像 (pull)</DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem onClick={async ()=>{
                              await executeTaskOperation(
                                `重启 ${first.name}`,
                                () => apiClient.post(`/api/v1/containers/${first.id}/restart`, { host: { id: first.hostId } }),
                                (result) => {
                                  if (result.taskId) {
                                    // TaskDrawer already opened and task selected by executeTaskOperation
                                  } else {
                                    toast.success(`重启完成：${first.name}`);
                                    refreshContainers(true);
                                  }
                                },
                                (error) => toast.error(`重启失败：${first.name} - ${error.message}`)
                              );
                            }}>重启容器</DropdownMenuItem>
                                {(() => {
                                  const s = (groupStatus.state || '').toLowerCase();
                                  const ss = (groupStatus.status || '').toLowerCase();
                                  const running = s.includes('running') || ss.includes('up');
                                  return (
                                    <>
                                      {!running && (
                                        <DropdownMenuItem onClick={async ()=>{
                                          await executeTaskOperation(
                                            `启动 ${first.name}`,
                                            () => apiClient.post(`/api/v1/containers/${first.id}/start`, { host: { id: first.hostId } }),
                                            (result) => {
                                              if (result.taskId) {
                                                // TaskDrawer already opened and task selected by executeTaskOperation
                                              } else {
                                                toast.success(`启动完成：${first.name}`);
                                                refreshContainers(true);
                                              }
                                            },
                                            (error) => toast.error(`启动失败：${first.name} - ${error.message}`)
                                          );
                                        }}>启动容器</DropdownMenuItem>
                                      )}
                                    </>
                                  );
                                })()}
                                {(() => {
                                  const s = (groupStatus.state || '').toLowerCase();
                                  const ss = (groupStatus.status || '').toLowerCase();
                                  const running = s.includes('running') || ss.includes('up');
                                  return (
                                    <>
                                      {running && (
                                        <DropdownMenuItem onClick={async ()=>{
                                          await executeTaskOperation(
                                            `停止 ${first.name}`,
                                            () => apiClient.post(`/api/v1/containers/${first.id}/stop`, { host: { id: first.hostId } }),
                                            (result) => {
                                              if (result.taskId) {
                                                // TaskDrawer already opened and task selected by executeTaskOperation
                                              } else {
                                                toast.success(`停止完成：${first.name}`);
                                                refreshContainers(true);
                                              }
                                            },
                                            (error) => toast.error(`停止失败：${first.name} - ${error.message}`)
                                          );
                                        }}>停止容器</DropdownMenuItem>
                                      )}
                                    </>
                                  );
                                })()}
                            <DropdownMenuItem onClick={async ()=>{
                              const i = first;
                              await executeTaskOperation(
                                `更新 ${i.name}`,
                                () => apiClient.post(`/api/v1/containers/${i.id}/update`, { host: { id: i.hostId } }),
                                (result) => {
                                  if (result.taskId) {
                                    // TaskDrawer already opened and task selected by executeTaskOperation
                                  } else {
                                    toast.success(`更新完成：${i.name}`);
                                    refreshContainers(true);
                                  }
                                },
                                (error) => toast.error(`更新失败：${i.name} - ${error.message}`)
                              );
                            }}>更新容器</DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem onClick={async ()=>{ 
                          const containerName = isCompose ? `${title} 组` : first.name;
                          if (isCompose) {
                            // Compose 组：检查该组所有容器
                            await executeTaskOperation(
                              `检查更新: ${title} 组`,
                              () => {
                                const body: any = { hostId: first.hostId };
                                if (first.composeProjectId) body.composeProjectId = first.composeProjectId;
                                else body.composeProject = first.composeProject || '';
                                return apiClient.post('/api/v1/containers/check-compose-updates', body);
                              },
                              (result) => {
                                if (result.taskId) {
                                  // TaskDrawer already opened and task selected by executeTaskOperation
                                } else {
                                  if (typeof result.updated === 'number') {
                                    toast.success(`${title} 组有 ${result.updated} 个容器可更新`);
                                  } else if (result.error) {
                                    toast.warning(`${title} 组检查失败: ${result.error}`);
                                  } else {
                                    toast.success(`${title} 组所有容器已是最新版本`);
                                  }
                                  refreshContainers(true);
                                }
                              },
                              (error) => toast.error(`检查 ${title} 组更新失败: ${error.message}`)
                            );
                          } else {
                            // 单个容器：检查该容器更新
                            await executeTaskOperation(
                              `检查更新: ${first.name}`,
                              () => apiClient.post(`/api/v1/containers/${first.id}/check-update`, {}),
                              (result) => {
                                if (result.taskId) {
                                  // TaskDrawer already opened and task selected by executeTaskOperation
                                } else {
                                  if (typeof result.updated === 'number') {
                                    toast.success(`${first.name} 有更新可用`);
                                  } else if (result.error) {
                                    toast.warning(`${first.name} 检查失败: ${result.error}`);
                                  } else {
                                    toast.success(`${first.name} 已是最新版本`);
                                  }
                                  refreshContainers(true);
                                }
                              },
                              (error) => toast.error(`检查 ${first.name} 更新失败: ${error.message}`)
                            );
                          }
                        }}>检查更新</DropdownMenuItem>
                        { (isCompose ? items.some(c => c.name.toLowerCase().includes('npm')) : title.toLowerCase().includes('npm')) &&
                          <DropdownMenuItem onClick={() => analyzeNpm.mutate(first.hostId)}>
                            分析npm
                          </DropdownMenuItem>
                        }
                        { (isCompose ? items.some(c => c.name.toLowerCase().includes('frp')) : title.toLowerCase().includes('frp')) &&
                          <DropdownMenuItem onClick={() => analyzeFrp.mutate(first.hostId)}>
                            分析frp
                          </DropdownMenuItem>
                        }
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {expandedGroup === key && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <div className="rounded border p-4">
                          <div className="mb-3 font-medium">
                            容器详情 - {isCompose ? (first.composeFolderName || first.composeProject) : first.name}
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>状态</TableHead>
                                <TableHead>名称</TableHead>
                                <TableHead>镜像</TableHead>
                                <TableHead>版本</TableHead>
                                <TableHead className="text-right">操作</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {items.map(i => {
                                return (
                                  <TableRow key={i.id}>
                                    <TableCell>
                                      <ContainerStatusIndicator
                                        state={i.state}
                                        status={i.status}
                                        isComposeManaged={i.isComposeManaged}
                                        containerName={i.name}
                                        hostName={i.hostId}
                                        lastUpdated={i.updatedAt}
                                        variant="compact"
                                      />
                                    </TableCell>
                                    <TableCell>
                                      <div className="font-medium">{i.name}</div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{i.imageName}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2">
                                        {(() => {
                                          const imageDot = getImageUpdateDot(i.imageUpdateStatus, i.updateAvailable);
                                          return imageDot ? (
                                            <div
                                            className={`w-2 h-2 rounded-full ${imageDot.color}`}
                                            title={imageDot.description}
                                            />
                                          ) : null;
                                        })()}
                                        <Badge variant="secondary">{i.imageTag || 'latest'}</Badge>
                                      </div>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <ManualPortDialog containerId={i.id} existingMapping={i.manualPortMapping}> 
                                        <Button variant="outline" size="sm">
                                          标记端口
                                        </Button>
                                      </ManualPortDialog>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      {/* 多选主机发现对话框 */}
      <DiscoverHostsDialog
        open={discoverDialogOpen}
        onOpenChange={setDiscoverDialogOpen}
        hosts={hostsQuery.data?.items || []}
        onConfirm={(hostIds) => discover.mutate(hostIds)}
        isLoading={discover.isPending}
      />
    </Card>
  );
}
