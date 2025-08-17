"use client";

import { useEffect, useMemo, useRef, useState, Fragment } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Toaster, toast } from 'sonner';
import { io, type Socket } from 'socket.io-client';

type ContainerItem = {
  id: string;
  name: string;
  state?: string;
  status?: string;
  imageName?: string;
  imageTag?: string;
  repoDigest?: string | null;
  remoteDigest?: string | null;
  updateAvailable?: boolean;
  restartCount?: number | null;
  isComposeManaged?: boolean;
  composeProject?: string | null;
  composeService?: string | null;
  composeWorkingDir?: string | null;
  composeFolderName?: string | null;
  hostId: string;
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
  const [composeOnly, setComposeOnly] = useState(false);
  const [opOpen, setOpOpen] = useState(false);
  const [opId, setOpId] = useState<string | null>(null);
  const [opTitle, setOpTitle] = useState<string>('');
  const [logs, setLogs] = useState<string[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const listQuery = useQuery<{ items: ContainerItem[] }>({
    queryKey: ['containers', q, updateOnly, hostFilter, composeOnly],
    queryFn: async () => {
      const url = new URL('http://localhost:3001/api/v1/containers');
      if (q) url.searchParams.set('q', q);
      if (updateOnly) url.searchParams.set('updateAvailable', 'true');
      if (hostFilter) url.searchParams.set('hostName', hostFilter);
      if (composeOnly) url.searchParams.set('composeManaged', 'true');
      const r = await fetch(url);
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    }
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
      'default',     // 灰色
      'secondary',   // 浅灰色
      'destructive', // 红色
      'outline',     // 边框样式
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

  // 容器状态映射和颜色
  const getContainerStatusBadge = (state?: string, status?: string) => {
    const normalizedState = state?.toLowerCase() || '';
    const normalizedStatus = status?.toLowerCase() || '';
    
    if (normalizedState.includes('running') || normalizedStatus.includes('up')) {
      return { variant: 'default' as const, text: 'Running', color: 'bg-green-500' };
    } else if (normalizedState.includes('starting') || normalizedStatus.includes('starting')) {
      return { variant: 'secondary' as const, text: 'Starting', color: 'bg-blue-500' };
    } else if (normalizedState.includes('exited') || normalizedState.includes('stopped') || normalizedStatus.includes('exited')) {
      return { variant: 'outline' as const, text: 'Stopped', color: 'bg-gray-500' };
    } else if (normalizedState.includes('error') || normalizedState.includes('failed') || normalizedStatus.includes('error')) {
      return { variant: 'destructive' as const, text: 'Error', color: 'bg-red-500' };
    } else if (normalizedState.includes('paused')) {
      return { variant: 'secondary' as const, text: 'Paused', color: 'bg-yellow-500' };
    } else if (normalizedState.includes('restarting')) {
      return { variant: 'secondary' as const, text: 'Restarting', color: 'bg-orange-500' };
    } else if (normalizedState.includes('created')) {
      return { variant: 'outline' as const, text: 'Created', color: 'bg-gray-400' };
    }
    
    return { variant: 'outline' as const, text: normalizedState || 'Unknown', color: 'bg-gray-400' };
  };

  const discover = useMutation({
    mutationFn: async (hostTarget: string | 'all') => {
      const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const title = hostTarget === 'all' ? '容器发现（全部主机）' : `容器发现（${hostTarget}）`;
      setOpId(id); setOpOpen(true); setOpTitle(title); setLogs([]);
      const body = hostTarget === 'all' 
        ? { opId: id }
        : { host: { id: hostTarget }, opId: id };
      const r = await fetch('http://localhost:3001/api/v1/containers/discover', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('发现失败');
      return r.json();
    },
    onMutate: (hostTarget) => {
      const hostName = hostTarget === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === hostTarget)?.name || hostTarget);
      toast.info(`开始容器发现：${hostName}`);
    },
    onSuccess: async (data: any, variables) => {
      const hostName = variables === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables);
      if (typeof data?.upserted === 'number') {
        toast.success(`发现完成（${hostName}）：新增/更新 ${data.upserted} 个`);
      } else {
        toast.success(`发现完成（${hostName}）`);
      }
      await qc.invalidateQueries({ queryKey: ['containers'] });
      // 额外延迟一次刷新，确保后端 discover 完成
      setTimeout(() => qc.invalidateQueries({ queryKey: ['containers'] }), 800);
    },
    onError: (err: any, variables) => {
      const hostName = variables === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables);
      toast.error(`发现失败（${hostName}）：${err?.message || '未知错误'}`);
    }
  });

  const checkUpdates = useMutation({
    mutationFn: async (hostTarget: string | 'all') => {
      const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const title = hostTarget === 'all' ? '检查镜像更新（全部主机）' : `检查镜像更新（${hostTarget}）`;
      setOpId(id); setOpOpen(true); setOpTitle(title); setLogs([]);
      const body = hostTarget === 'all' 
        ? { opId: id }
        : { host: { id: hostTarget }, opId: id };
      const r = await fetch('http://localhost:3001/api/v1/containers/check-updates', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('检查失败');
      return r.json();
    },
    onMutate: (hostTarget) => {
      const hostName = hostTarget === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === hostTarget)?.name || hostTarget);
      toast.info(`开始检查镜像更新：${hostName}`);
    },
    onSuccess: async (data: any, variables) => {
      const hostName = variables === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables);
      if (typeof data?.updated === 'number') {
        toast.success(`检查完成（${hostName}）：可更新 ${data.updated} 个`);
      } else {
        toast.success(`检查完成（${hostName}）`);
      }
      await qc.invalidateQueries({ queryKey: ['containers'] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ['containers'] }), 800);
    },
    onError: (err: any, variables) => {
      const hostName = variables === 'all' ? '全部主机' : (hostsQuery.data?.items?.find(h => h.id === variables)?.name || variables);
      toast.error(`检查失败（${hostName}）：${err?.message || '未知错误'}`);
    }
  });

  // Compose 操作（改为直接调用后端 compose/operate 接口）
  const composeOperation = useMutation({
    mutationFn: async ({ hostId, project, workingDir, operation }: { hostId: string; project: string; workingDir: string; operation: 'down' | 'pull' | 'up' | 'restart' | 'start' | 'stop' }) => {
      const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setOpId(id); setOpOpen(true); setOpTitle(`Compose ${operation}: ${project}`); setLogs([]);
      const r = await fetch('http://localhost:3001/api/v1/containers/compose/operate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, project, workingDir, op: operation, opId: id })
      });
      if (!r.ok) throw new Error(`${operation} 操作失败`);
      return r.json();
    },
    onMutate: ({ project, operation }) => {
      toast.info(`Compose ${operation} 已触发：${project}`);
    },
    onSuccess: async (data: any, { project }) => {
      if (typeof data?.code === 'number') {
        toast.success(`Compose 操作完成：${project}（退出码 ${data.code}）`);
      } else {
        toast.success(`Compose 操作完成：${project}`);
      }
      await qc.invalidateQueries({ queryKey: ['containers'] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ['containers'] }), 800);
    },
    onError: (err: any, { project, operation }) => {
      toast.error(`Compose ${operation} 失败：${project} - ${err?.message || '未知错误'}`);
    }
  });

  useEffect(() => {
    if (!opOpen || !opId) return;
    const s = io('http://localhost:3001', { transports: ['websocket'] });
    socketRef.current = s;
    s.on('connect', () => { s.emit('joinTask', { taskId: opId }); });
    const onData = (d: string) => setLogs(ls => [...ls, d]);
    const onErr = (d: string) => setLogs(ls => [...ls, `[stderr] ${d}`]);
    const onEnd = (p: any) => setLogs(ls => [...ls, `--- 结束: ${JSON.stringify(p)} ---`]);
    s.on('data', onData); s.on('stderr', onErr); s.on('end', onEnd);
    return () => { s.off('data', onData); s.off('stderr', onErr); s.off('end', onEnd); s.disconnect(); };
  }, [opOpen, opId]);

  return (
    <Card>
      <CardHeader><CardTitle>容器</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-center flex-wrap">
          <Input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="搜索容器/镜像" className="max-w-xs" />
          <Button variant={updateOnly ? 'secondary' : 'default'} onClick={()=>setUpdateOnly(v=>!v)}>{updateOnly ? '显示全部' : '仅看可更新'}</Button>
          <Button variant={composeOnly ? 'secondary' : 'ghost'} onClick={()=>setComposeOnly(v=>!v)}>{composeOnly ? '显示全部' : '仅 Compose'}</Button>
          
          
          
          <div className="ml-auto flex gap-2">
            <Select value={hostFilter || "all"} onValueChange={(value) => setHostFilter(value === "all" ? "" : value)}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="选择主机" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部主机</SelectItem>
                {hostsQuery.data?.items?.map(host => (
                  <SelectItem key={host.id} value={host.name}>
                    {host.name} ({host.address})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>发现容器</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => discover.mutate('all')}>
                  全部主机
                </DropdownMenuItem>
                {hostsQuery.data?.items?.map(host => (
                  <DropdownMenuItem key={host.id} onClick={() => discover.mutate(host.id)}>
                    {host.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>检查更新</Button>
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
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>主机</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>容器</TableHead>
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
              
              // 计算组的综合状态（含部分运行判定）
              const getGroupStatus = () => {
                // 状态优先级：error > restarting > starting > running > paused > stopped > created > unknown
                const priorities = {
                  error: 8, failed: 8,
                  restarting: 7,
                  starting: 6,
                  running: 5, up: 5,
                  paused: 4,
                  stopped: 3, exited: 3,
                  created: 2,
                  unknown: 1
                } as const;
                
                let highestPriority = 0;
                let bestStatus = { state: 'unknown', status: '' };
                let runningCount = 0;
                let stoppedCount = 0;
                
                for (const item of items) {
                  const stateLower = (item.state || '').toLowerCase();
                  const statusLower = (item.status || '').toLowerCase();
                  const isRunning = stateLower.includes('running') || statusLower.includes('up');
                  const isStopped = stateLower.includes('exited') || stateLower.includes('stopped') || statusLower.includes('exited') || statusLower.includes('stopped');
                  if (isRunning) runningCount++; else if (isStopped) stoppedCount++;
                  
                  for (const [key, priority] of Object.entries(priorities)) {
                    if ((stateLower.includes(key) || statusLower.includes(key)) && priority > highestPriority) {
                      highestPriority = priority;
                      bestStatus = { state: item.state || '', status: item.status || '' };
                    }
                  }
                }
                const totalCount = items.length;
                const partial = runningCount > 0 && stoppedCount > 0;
                return { ...bestStatus, meta: { totalCount, runningCount, stoppedCount, partial, anyRunning: runningCount > 0, anyStopped: stoppedCount > 0 } } as const;
              };
              
              const groupStatus = getGroupStatus();
              const statusBadge = (groupStatus as any).meta?.partial
                ? { variant: 'secondary' as const, text: '部分运行', color: 'bg-yellow-500' }
                : getContainerStatusBadge(groupStatus.state, groupStatus.status);
              
              return (
                <Fragment key={key}>
                  <TableRow>
                    <TableCell>
                      <Badge variant={getHostBadgeColor(first.hostId)}>
                        {getHostName(first.hostId)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadge.variant} className={`text-white ${statusBadge.color}`}>
                        {statusBadge.text}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">
                            {title}
                            {isCompose ? (
                              <span className="ml-2"><Badge variant="secondary">compose</Badge></span>
                            ) : (
                              <span className="ml-2"><Badge variant="secondary">cli</Badge></span>
                            )}
                            {(() => {
                              // 检查组或容器是否有更新可用
                              const hasUpdate = items.some(item => item.updateAvailable);
                              return hasUpdate ? (
                                <Badge className="bg-amber-500 text-black hover:bg-amber-500 ml-2">可更新</Badge>
                              ) : null;
                            })()}
                            <span className="ml-2 text-xs text-muted-foreground">{isCompose ? `${items.length} 个服务` : ''}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => setExpandedGroup(expandedGroup === key ? null : key)}
                          >
                            {expandedGroup === key ? '收起' : '展开'}
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm">操作</Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
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
                            }}>重启服务</DropdownMenuItem>
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
                                    }}>启动服务(start)</DropdownMenuItem>
                                  )}
                                  {(running || partial) && (
                                    <DropdownMenuItem onClick={() => {
                                      composeOperation.mutate({ hostId: first.hostId, project: first.composeProject || 'unknown', workingDir, operation: 'stop' });
                                    }}>停止服务(stop)</DropdownMenuItem>
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
                                operation: 'pull' 
                              });
                            }}>拉取镜像</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              const workingDir = first.composeWorkingDir || `/path/to/${first.composeProject}`;
                              composeOperation.mutate({ 
                                hostId: first.hostId, 
                                project: first.composeProject || 'unknown', 
                                workingDir, 
                                operation: 'up' 
                              });
                            }}>重新部署</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => {
                              const workingDir = first.composeWorkingDir || `/path/to/${first.composeProject}`;
                              composeOperation.mutate({ 
                                hostId: first.hostId, 
                                project: first.composeProject || 'unknown', 
                                workingDir, 
                                operation: 'down' 
                              });
                            }}>下线（down）</DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem onClick={async ()=>{
                              const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                              const i = first;
                              setOpId(id); setOpOpen(true); setOpTitle(`更新 ${i.name}`); setLogs([]);
                              toast.info(`已触发更新：${i.name}`);
                              try {
                                const r = await fetch(`http://localhost:3001/api/v1/containers/${i.id}/update`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: i.hostId }, opId: id }) });
                                if (!r.ok) throw new Error(await r.text());
                                toast.success(`更新请求已受理：${i.name}`);
                                qc.invalidateQueries({ queryKey: ['containers'] });
                              } catch (e: any) {
                                toast.error(`更新触发失败：${i.name} - ${e?.message || '未知错误'}`);
                              }
                            }}>更新容器</DropdownMenuItem>
                                {(() => {
                                  const s = (groupStatus.state || '').toLowerCase();
                                  const ss = (groupStatus.status || '').toLowerCase();
                                  const running = s.includes('running') || ss.includes('up');
                                  return (
                                    <>
                                      {!running && (
                                        <DropdownMenuItem onClick={async ()=>{
                                          const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                                          setOpId(id); setOpOpen(true); setOpTitle(`启动 ${first.name}`); setLogs([]);
                                          toast.info(`已触发启动：${first.name}`);
                                          try {
                                            const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/start`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: first.hostId }, opId: id }) });
                                            if (!r.ok) throw new Error(await r.text());
                                            toast.success(`启动请求已受理：${first.name}`);
                                            qc.invalidateQueries({ queryKey: ['containers'] });
                                          } catch (e: any) {
                                            toast.error(`启动触发失败：${first.name} - ${e?.message || '未知错误'}`);
                                          }
                                        }}>启动容器</DropdownMenuItem>
                                      )}
                                    </>
                                  );
                                })()}
                            <DropdownMenuItem onClick={async ()=>{
                              const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                              setOpId(id); setOpOpen(true); setOpTitle(`重启 ${first.name}`); setLogs([]);
                              toast.info(`已触发重启：${first.name}`);
                              try {
                                const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/restart`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: first.hostId }, opId: id }) });
                                if (!r.ok) throw new Error(await r.text());
                                toast.success(`重启请求已受理：${first.name}`);
                              } catch (e: any) {
                                toast.error(`重启触发失败：${first.name} - ${e?.message || '未知错误'}`);
                              }
                            }}>重启容器</DropdownMenuItem>
                                {(() => {
                                  const s = (groupStatus.state || '').toLowerCase();
                                  const ss = (groupStatus.status || '').toLowerCase();
                                  const running = s.includes('running') || ss.includes('up');
                                  return (
                                    <>
                                      {running && (
                                        <DropdownMenuItem onClick={async ()=>{
                                          const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                                          setOpId(id); setOpOpen(true); setOpTitle(`停止 ${first.name}`); setLogs([]);
                                          toast.info(`已触发停止：${first.name}`);
                                          try {
                                            const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/stop`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: first.hostId }, opId: id }) });
                                            if (!r.ok) throw new Error(await r.text());
                                            toast.success(`停止请求已受理：${first.name}`);
                                            qc.invalidateQueries({ queryKey: ['containers'] });
                                          } catch (e: any) {
                                            toast.error(`停止触发失败：${first.name} - ${e?.message || '未知错误'}`);
                                          }
                                        }}>停止容器</DropdownMenuItem>
                                      )}
                                    </>
                                  );
                                })()}
                          </>
                        )}
                        <DropdownMenuItem onClick={async ()=>{
                          const id = `op_${Date.now()}_${Math.random().toString(36).slice(2)}`;
                          const containerName = isCompose ? `${title} 组` : first.name;
                          setOpId(id); setOpOpen(true); setOpTitle(`检查更新: ${containerName}`); setLogs([]);
                          
                          if (isCompose) {
                            // Compose 组：检查该组所有容器
                            toast.info(`检查 ${title} 组的更新...`);
                            try {
                              const r = await fetch('http://localhost:3001/api/v1/containers/check-compose-updates', { 
                                method: 'POST', 
                                headers: {'Content-Type': 'application/json'}, 
                                body: JSON.stringify({ 
                                  hostId: first.hostId, 
                                  composeProject: first.composeProject || '', 
                                  opId: id 
                                }) 
                              });
                              if (!r.ok) throw new Error('检查失败');
                              const result = await r.json();
                              if (result.updated > 0) {
                                toast.success(`${title} 组有 ${result.updated} 个容器可更新`);
                              } else if (result.error) {
                                toast.warning(`${title} 组检查失败: ${result.error}`);
                              } else {
                                toast.success(`${title} 组所有容器已是最新版本`);
                              }
                              qc.invalidateQueries({ queryKey: ['containers'] });
                            } catch (e: any) {
                              toast.error(`检查 ${title} 组更新失败: ${e?.message || '未知错误'}`);
                            }
                          } else {
                            // CLI 容器：只检查这一个容器
                            toast.info(`检查 ${first.name} 的更新...`);
                            try {
                              const r = await fetch(`http://localhost:3001/api/v1/containers/${first.id}/check-update`, { 
                                method: 'POST', 
                                headers: {'Content-Type': 'application/json'}, 
                                body: JSON.stringify({ opId: id }) 
                              });
                              if (!r.ok) throw new Error('检查失败');
                              const result = await r.json();
                              if (result.updated > 0) {
                                toast.success(`${first.name} 有更新可用`);
                              } else if (result.error) {
                                toast.warning(`${first.name} 检查失败: ${result.error}`);
                              } else {
                                toast.success(`${first.name} 已是最新版本`);
                              }
                              qc.invalidateQueries({ queryKey: ['containers'] });
                            } catch (e: any) {
                              toast.error(`检查 ${first.name} 更新失败: ${e?.message || '未知错误'}`);
                            }
                          }
                        }}>检查更新</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  {expandedGroup === key && (
                    <TableRow>
                      <TableCell colSpan={4}>
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
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {items.map(i => {
                                const containerStatusBadge = getContainerStatusBadge(i.state, i.status);
                                return (
                                  <TableRow key={i.id}>
                                    <TableCell>
                                      <Badge variant={containerStatusBadge.variant} className={`text-white ${containerStatusBadge.color}`}>
                                        {containerStatusBadge.text}
                                      </Badge>
                                    </TableCell>
                                    <TableCell>
                                      <div className="font-medium">{i.name}</div>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{i.imageName}</TableCell>
                                    <TableCell>
                                      <Badge variant="secondary">{i.imageTag || 'latest'}</Badge>
                                      {i.updateAvailable ? (
                                        <Badge className="bg-amber-500 text-black hover:bg-amber-500 mx-2">可更新</Badge>
                                      ) : null}
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
      <Dialog open={opOpen} onOpenChange={(o)=>{ setOpOpen(o); if(!o){ setLogs([]); setOpId(null); } }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{opTitle}</DialogTitle>
          </DialogHeader>
          <div className="mt-2">
            <pre className="h-80 overflow-auto whitespace-pre-wrap text-sm bg-muted p-3 rounded">{logs.join('\n')}</pre>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}


