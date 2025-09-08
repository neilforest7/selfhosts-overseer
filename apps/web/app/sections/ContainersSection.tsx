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
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { getUpdateStatusDisplay, ImageUpdateStatus } from '@selfhost-serv-agent/shared';


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
  const { startOperation, fetchTasks, selectTask, setOpen } = useTaskDrawerStore((s) => s.actions);

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
        const response = await fetch(`http://localhost:3001/api/v1/operations/${taskId}`);
        if (!response.ok) break;

        const operation = await response.json();

        if (operation.status === 'COMPLETED') {
          toast.success(`${operationName}完成`);
          await refreshContainers(true);
          return;
        } else if (operation.status === 'ERROR') {
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
      const response = await fetch('http://localhost:3001/api/v1/containers/refresh-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: { id: 'all' } }),
      });
      if (!response.ok) {
        throw new Error(`刷新失败: ${response.statusText}`);
      }
      return response.json();
    },
    onSuccess: async (data) => {
      toast.success('容器状态刷新已启动');
      // Monitor the operation status and refresh UI when complete
      if (data.taskId) {
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
      const url = new URL('http://localhost:3001/api/v1/containers');
      if (q) url.searchParams.set('q', q);
      if (updateOnly) url.searchParams.set('updateAvailable', 'true');
      if (hostFilter) url.searchParams.set('hostName', hostFilter);
      if (filterMode === 'compose') {
        url.searchParams.set('composeManaged', 'true');
      } else if (filterMode === 'cli') {
        url.searchParams.set('composeManaged', 'false');
      }
      const r = await fetch(url);
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    },
    refetchInterval: 30000, // 减少到30秒自动刷新，避免竞态条件
    refetchIntervalInBackground: false, // 页面在后台时停止刷新，减少竞态条件
  });

  const hostsQuery = useQuery<{ items: HostItem[] }>({ 
    queryKey: ['hosts'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/hosts');
      if (!r.ok) throw new Error('加载主机失败');
      return r.json();
    }
  });

  // 主机颜色映射 - 使用更多样化的颜色
  const getHostBadgeColor = useMemo(() => {
    const colors = [
      'bg-slate-600',     // 灰色
      'bg-sky-600',   // 浅灰色
      // 'bg-cyan-600', // 红色
      'bg-teal-600',     // 边框样式
      'bg-emerald-600',
      // 'bg-green-600',
      // 'bg-lime-600',
      'bg-yellow-600',
      'bg-amber-600',
      'bg-orange-600',
      'bg-red-600',
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

  // 容器状态映射和颜色 - 支持新的容器生命周期状态
  const getContainerStatusBadge = (state?: string, status?: string, isComposeManaged?: boolean) => {
    const normalizedState = state?.toLowerCase() || '';
    const normalizedStatus = status?.toLowerCase() || '';

    // 优先处理新增的容器生命周期状态
    if (normalizedState === 'removed') {
      return {
        variant: 'destructive' as const,
        text: '已移除',
        color: 'bg-red-600',
        description: '容器已从Docker中移除但数据库记录仍存在'
      };
    } else if (normalizedState === 'compose-down') {
      return {
        variant: 'outline' as const,
        text: '已下线',
        color: 'bg-foreground',
        description: '通过docker compose down停止的容器'
      };
    }

    // 处理标准Docker容器状态
    if (normalizedState.includes('running') || normalizedStatus.includes('up')) {
      return {
        variant: 'default' as const,
        text: '运行中',
        color: 'bg-green-500',
        description: '容器正在正常运行'
      };
    } else if (normalizedState.includes('starting') || normalizedStatus.includes('starting')) {
      return {
        variant: 'secondary' as const,
        text: '启动中',
        color: 'bg-blue-500',
        description: '容器正在启动过程中'
      };
    } else if (normalizedState.includes('exited') || normalizedState.includes('stopped') || normalizedStatus.includes('exited')) {
      // 区分CLI容器和Compose容器的停止状态显示
      const text = isComposeManaged ? '已停止' : '已退出';
      const description = isComposeManaged ? 'Compose服务已停止' : 'CLI容器已退出';
      return {
        variant: 'outline' as const,
        text,
        color: 'bg-gray-500',
        description
      };
    } else if (normalizedState.includes('error') || normalizedState.includes('failed') || normalizedStatus.includes('error')) {
      return {
        variant: 'destructive' as const,
        text: '错误',
        color: 'bg-red-500',
        description: '容器运行出现错误'
      };
    } else if (normalizedState.includes('paused')) {
      return {
        variant: 'secondary' as const,
        text: '已暂停',
        color: 'bg-yellow-500',
        description: '容器已暂停执行'
      };
    } else if (normalizedState.includes('restarting')) {
      return {
        variant: 'secondary' as const,
        text: '重启中',
        color: 'bg-orange-500',
        description: '容器正在重启'
      };
    } else if (normalizedState.includes('created')) {
      return {
        variant: 'outline' as const,
        text: '已创建',
        color: 'bg-gray-400',
        description: '容器已创建但未启动'
      };
    }

    // 未知状态的处理
    return {
      variant: 'outline' as const,
      text: normalizedState || '未知',
      color: 'bg-gray-400',
      description: '容器状态未知或无法识别'
    };
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

      const r = await fetch('http://localhost:3001/api/v1/containers/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('发现失败');
      return r.json();
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
      const r = await fetch('http://localhost:3001/api/v1/containers/check-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('检查失败');
      return r.json();
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
      const r = await fetch('http://localhost:3001/api/v1/containers/compose/operate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, project, workingDir, op: operation })
      });
      if (!r.ok) throw new Error(`${operation} 操作失败`);
      return r.json();
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
      const r = await fetch(`http://localhost:3001/api/v1/reverse-proxy/sync/${hostId}`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error('分析请求失败');
      return r.json();
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
      const r = await fetch(`http://localhost:3001/api/v1/frp/sync/${hostId}`, {
        method: 'POST',
      });
      if (!r.ok) throw new Error('分析请求失败');
      return r.json();
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
              const statusBadge = (groupStatus as any).meta?.partial
                ? { variant: 'secondary' as const, text: '部分运行', color: 'bg-yellow-500', description: '部分容器正在运行，部分已停止' }
                : getContainerStatusBadge(groupStatus.state, groupStatus.status, isCompose);
              
              return (
                <Fragment key={key}> 
                  <TableRow>
                    <TableCell>
                      <Badge className={getHostBadgeColor(first.hostId)}>
                        {getHostName(first.hostId)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusBadge.variant}
                        className={`text-white ${statusBadge.color}`}
                        title={statusBadge.description}
                      >
                        {statusBadge.text}
                      </Badge>
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
                            variant="ghost" 
                            size="sm"
                            onClick={() => setExpandedGroup(expandedGroup === key ? null : key)}
                          >
                            {expandedGroup === key ? <ChevronsDownUp /> : <ChevronsUpDown />}
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {isCompose ? (
                        <span><Badge variant="secondary">compose</Badge></span>
                      ) : (
                        <span><Badge variant="secondary">cli</Badge></span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="outline">操作</Button>
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
                              const opId = await startOperation(`重启 ${first.name}`);
                              toast.info(`正在重启：${first.name}`);
                              try {
                                const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/restart`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: first.hostId }, opId }) });
                                if (!r.ok) throw new Error(await r.text());
                                const result = await r.json();
                                if (result.taskId) {
                                  await monitorOperationStatus(result.taskId, `重启 ${first.name}`);
                                } else {
                                  toast.success(`重启完成：${first.name}`);
                                  await refreshContainers(true);
                                }
                              } catch (e: any) {
                                toast.error(`重启失败：${first.name} - ${e?.message || '未知错误'}`);
                              }
                            }}>重启容器</DropdownMenuItem>
                                {(() => {
                                  const s = (groupStatus.state || '').toLowerCase();
                                  const ss = (groupStatus.status || '').toLowerCase();
                                  const running = s.includes('running') || ss.includes('up');
                                  return (
                                    <>
                                      {!running && (
                                        <DropdownMenuItem onClick={async ()=>{
                                          const opId = await startOperation(`启动 ${first.name}`);
                                          toast.info(`正在启动：${first.name}`);
                                          try {
                                            const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/start`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: first.hostId }, opId }) });
                                            if (!r.ok) throw new Error(await r.text());
                                            const result = await r.json();
                                            if (result.taskId) {
                                              await monitorOperationStatus(result.taskId, `启动 ${first.name}`);
                                            } else {
                                              toast.success(`启动完成：${first.name}`);
                                              await refreshContainers(true);
                                            }
                                          } catch (e: any) {
                                            toast.error(`启动失败：${first.name} - ${e?.message || '未知错误'}`);
                                          }
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
                                          const opId = await startOperation(`停止 ${first.name}`);
                                          toast.info(`正在停止：${first.name}`);
                                          try {
                                            const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/stop`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: first.hostId }, opId }) });
                                            if (!r.ok) throw new Error(await r.text());
                                            const result = await r.json();
                                            if (result.taskId) {
                                              await monitorOperationStatus(result.taskId, `停止 ${first.name}`);
                                            } else {
                                              toast.success(`停止完成：${first.name}`);
                                              await refreshContainers(true);
                                            }
                                          } catch (e: any) {
                                            toast.error(`停止失败：${first.name} - ${e?.message || '未知错误'}`);
                                          }
                                        }}>停止容器</DropdownMenuItem>
                                      )}
                                    </>
                                  );
                                })()}
                            <DropdownMenuItem onClick={async ()=>{
                              const i = first;
                              const opId = await startOperation(`更新 ${i.name}`);
                              toast.info(`正在更新：${i.name}`);
                              try {
                                const r = await fetch(`http://localhost:3001/api/v1/containers/${i.id}/update`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: i.hostId }, opId }) });
                                if (!r.ok) throw new Error(await r.text());
                                const result = await r.json();
                                if (result.taskId) {
                                  await monitorOperationStatus(result.taskId, `更新 ${i.name}`);
                                } else {
                                  toast.success(`更新完成：${i.name}`);
                                  await refreshContainers(true);
                                }
                              } catch (e: any) {
                                toast.error(`更新失败：${i.name} - ${e?.message || '未知错误'}`);
                              }
                            }}>更新容器</DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuItem onClick={async ()=>{ 
                          const containerName = isCompose ? `${title} 组` : first.name;
                          // 不再人为创建 Operation（避免重复日志），直接调用后端接口
                          if (isCompose) {
                            toast.info(`检查 ${title} 组的更新...`);
                            try {
                              const body: any = { hostId: first.hostId };
                              if (first.composeProjectId) body.composeProjectId = first.composeProjectId;
                              else body.composeProject = first.composeProject || '';
                              const r = await fetch('http://localhost:3001/api/v1/containers/check-compose-updates', { 
                                method: 'POST', 
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify(body)
                              });
                              if (!r.ok) throw new Error('检查失败');
                              const result = await r.json();
                              if (result.taskId) {
                                await monitorOperationStatus(result.taskId, `检查 ${title} 组更新`);
                              } else {
                                if (typeof result.updated === 'number') {
                                  toast.success(`${title} 组有 ${result.updated} 个容器可更新`);
                                } else if (result.error) {
                                  toast.warning(`${title} 组检查失败: ${result.error}`);
                                } else {
                                  toast.success(`${title} 组所有容器已是最新版本`);
                                }
                                await refreshContainers(true);
                              }
                            } catch (e: any) {
                              toast.error(`检查 ${title} 组更新失败: ${e?.message || '未知错误'}`);
                            }
                          } else {
                            toast.info(`检查 ${first.name} 的更新...`);
                            try {
                              const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/check-update`, { 
                                method: 'POST', 
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({})
                              });
                              if (!r.ok) throw new Error('检查失败');
                              const result = await r.json();
                              if (result.taskId) {
                                await monitorOperationStatus(result.taskId, `检查 ${first.name} 更新`);
                              } else {
                                if (typeof result.updated === 'number') {
                                  toast.success(`${first.name} 有更新可用`);
                                } else if (result.error) {
                                  toast.warning(`${first.name} 检查失败: ${result.error}`);
                                } else {
                                  toast.success(`${first.name} 已是最新版本`);
                                }
                                await refreshContainers(true);
                              }
                            } catch (e: any) {
                              toast.error(`检查 ${first.name} 更新失败: ${e?.message || '未知错误'}`);
                            }
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
                                const containerStatusBadge = getContainerStatusBadge(i.state, i.status, i.isComposeManaged);
                                return (
                                  <TableRow key={i.id}>
                                    <TableCell>
                                      <Badge
                                        variant={containerStatusBadge.variant}
                                        className={`text-white ${containerStatusBadge.color}`}
                                        title={containerStatusBadge.description}
                                      >
                                        {containerStatusBadge.text}
                                      </Badge>
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
