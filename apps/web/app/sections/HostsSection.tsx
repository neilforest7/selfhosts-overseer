"use client";

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ClientOnly } from '@/components/ClientOnly';
import { HostStatusIndicator } from '@/components/HostStatusIndicator';
import { useHostConnectivity, HostStatus } from '@/lib/hooks/useHostConnectivity';
import { apiClient } from '@/src/lib/api-client';

type Host = { id: string; name: string; address: string; sshUser: string; port?: number; tags?: string[]; role?: 'local' | 'remote'; hasPassword?: boolean; hasPrivateKey?: boolean; status: HostStatus; lastConnectivityCheck?: string | Date | null; };

export default function HostsSection() {
  const qc = useQueryClient();
  const [tag, setTag] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Host> | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});

  // Add connectivity hook
  const {
    isConnected,
    connectionError,
    stats,
    checkConnectivity,
    getHostConnectivity
  } = useHostConnectivity();

  const hostsQuery = useQuery<{ items: Host[]; nextCursor: string | null }>({
    queryKey: ['hosts', tag, cursor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (tag) params.set('tag', tag);
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '20');
      
      const response = await apiClient.get<{ items: Host[]; nextCursor: string | null }>(`/api/v1/hosts?${params.toString()}`);
      if (!response.success) throw new Error(response.error || '加载失败');
      return response.data;
    }
  });

  const addMutation = useMutation({
    mutationFn: async (body: Partial<Host>) => {
      const response = await apiClient.post<Host>('/api/v1/hosts', body);
      if (!response.success) throw new Error(response.error || '创建失败');
      return response.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hosts'] }); toast.success('已创建主机'); setDialogOpen(false); setEditing(null); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...partial }: Partial<Host> & { id: string }) => {
      const response = await apiClient.patch<Host>(`/api/v1/hosts/${id}`, partial);
      if (!response.success) throw new Error(response.error || '更新失败');
      return response.data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hosts'] }); toast.success('已更新主机'); setDialogOpen(false); setEditing(null); },
  });

  const bulkDelete = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      const response = await apiClient.delete(`/api/v1/hosts/${id}`);
      if (!response.success) throw new Error(response.error || `删除失败: ${id}`);
    }
    toast.success(`已删除 ${ids.length} 项`);
    setSelected({});
    qc.invalidateQueries({ queryKey: ['hosts'] });
  };

  const allSelected = useMemo(() => {
    const list = hostsQuery.data?.items || [];
    if (list.length === 0) return false;
    return list.every((h) => selected[h.id]);
  }, [hostsQuery.data, selected]);

  const testConnection = async (id: string, hostName: string) => {
    setTesting(prev => ({ ...prev, [id]: true }));
    try {
      toast.info(`正在测试连接：${hostName}`);

      const response = await apiClient.post(`/api/v1/hosts/${id}/test-connection`, {});
      
      if (response.success) {
        toast.success(`连通性正常：${hostName}`);
      } else {
        const detail = (response.data?.stderr || response.data?.stdout || '').toString().slice(0, 200);
        toast.error(`连通性失败：${hostName} - ${detail || '请检查地址/端口/认证方式'}`);
      }
    } catch (error) {
      toast.error(`测试连接时发生错误：${hostName}`);
    } finally {
      setTesting(prev => ({ ...prev, [id]: false }));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>主机</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="按标签筛选" className="max-w-xs" />
          <ClientOnly>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditing({ role: 'local' })}>新建主机</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{editing?.id ? '编辑主机' : '新建主机'}</DialogTitle></DialogHeader>
                <div className="grid gap-4">
                  <Input placeholder="名称" defaultValue={editing?.name} onChange={(e) => setEditing((p) => ({ ...(p || {}), name: e.target.value }))} />
                  <Input placeholder="地址/IP" defaultValue={editing?.address} onChange={(e) => setEditing((p) => ({ ...(p || {}), address: e.target.value }))} />
                  <Input placeholder="SSH 用户" defaultValue={editing?.sshUser} onChange={(e) => setEditing((p) => ({ ...(p || {}), sshUser: e.target.value }))} />
                  <Input placeholder="端口（可选）" type="number" defaultValue={editing?.port} onChange={(e) => setEditing((p) => ({ ...(p || {}), port: Number(e.target.value) }))} />
                  <div className="grid gap-3">
                    <Label>主机角色</Label>
                    <Select
                      value={editing?.role || 'local'}
                      onValueChange={(value) => setEditing((p) => ({ ...(p || {}), role: value as 'local' | 'remote' }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="选择主机角色" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="local">本地主机 (Local Network)</SelectItem>
                        <SelectItem value="remote">公网主机 (Public Cloud)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Label>主机标签</Label>
                  <Input placeholder="标签，逗号分隔" defaultValue={(editing?.tags || []).join(',')} onChange={(e) => setEditing((p) => ({ ...(p || {}), tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
                  <div className="grid gap-2">
                    <Label className="text-sm">认证方式</Label>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="sshAuthMethod"
                          defaultChecked={(editing as any)?.sshAuthMethod !== 'privateKey'}
                          onChange={() => setEditing((p)=>({ ...(p||{}), sshAuthMethod: 'password', sshPrivateKey: undefined, sshPrivateKeyPassphrase: undefined }))}
                        />
                        密码
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name="sshAuthMethod"
                          defaultChecked={(editing as any)?.sshAuthMethod === 'privateKey'}
                          onChange={() => setEditing((p)=>({ ...(p||{}), sshAuthMethod: 'privateKey', sshPassword: undefined }))}
                        />
                        私钥
                      </label>
                    </div>
                  </div>
                  {((editing as any)?.sshAuthMethod ?? 'password') === 'password' ? (
                    <Input placeholder="密码" type="password" onChange={(e)=>setEditing((p)=>({ ...(p||{}), sshPassword: e.target.value }))} />
                  ) : (
                    <>
                      <Textarea placeholder="粘贴私钥 PEM" rows={6} onChange={(e)=>setEditing((p)=>({ ...(p||{}), sshPrivateKey: e.target.value }))} />
                      <Input placeholder="私钥口令（可选）" type="password" onChange={(e)=>setEditing((p)=>({ ...(p||{}), sshPrivateKeyPassphrase: e.target.value }))} />
                    </>
                  )}
                  <div className="flex justify-end gap-2">
                    {editing?.id ? (
                      <Button onClick={() => editing?.id && updateMutation.mutate({ ...(editing as Host), id: editing.id })} disabled={updateMutation.isPending}>保存</Button>
                    ) : (
                      <Button onClick={() => addMutation.mutate(editing || {})} disabled={addMutation.isPending}>创建</Button>
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </ClientOnly>
          <Button variant="destructive" onClick={bulkDelete} disabled={!Object.values(selected).some(Boolean)}>删除所选</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 text-center"><Checkbox checked={allSelected} onCheckedChange={(v) => {
                const items = hostsQuery.data?.items || [];
                const next: Record<string, boolean> = { ...selected };
                items.forEach((h) => { next[h.id] = v === true; });
                setSelected(next);
              }} /></TableHead>
              <TableHead>名称</TableHead>
              <TableHead>地址</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>标签</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(hostsQuery.data?.items || []).map((h) => {
              const connectivity = getHostConnectivity(h.id);
              return (
              <TableRow key={h.id}>
                <TableCell className="text-center"><Checkbox checked={!!selected[h.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [h.id]: v === true }))} /></TableCell>
                <TableCell>{h.name}</TableCell>
                <TableCell className="text-muted-foreground">{h.address}</TableCell>
                <TableCell>
                  <HostStatusIndicator
                    status={connectivity?.status || h.status || 'UNKNOWN'}
                    responseTime={connectivity?.responseTime}
                    lastChecked={connectivity?.lastChecked || h.lastConnectivityCheck || undefined}
                    lastOnline={connectivity?.lastOnline}
                    lastOffline={connectivity?.lastOffline}
                    errorMessage={connectivity?.errorMessage}
                    variant="compact"
                  />
                </TableCell>
                <TableCell>
                  <Badge variant={h.role === 'remote' ? 'secondary' : 'secondary'}>
                    {h.role === 'remote' ? '公网' : '内网'}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{h.sshUser}</TableCell>
                <TableCell className="space-x-1">
                  {(h.tags || []).map((t) => (<Badge variant="secondary" key={t}>{t}</Badge>))}
                  {(h.hasPrivateKey || h.hasPassword) ? (
                    <Badge variant="secondary" className="inline-flex items-center text-xs">已存在凭据</Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  {/* <Button variant="secondary" onClick={()=>{ setEditing(h); setDialogOpen(true); }}>修改凭据</Button> */}
                  <Button variant="secondary" onClick={()=>testConnection(h.id, h.name)} disabled={testing[h.id]}>
                    {testing[h.id] ? '测试中...' : '测试连接'}
                  </Button>
                  <Button onClick={() => { setEditing(h); setDialogOpen(true); }}>编辑</Button>
                  <Button variant="destructive" onClick={async ()=>{
  const response = await apiClient.delete(`/api/v1/hosts/${h.id}`);
  if (!response.success) {
    toast.error(`删除失败: ${response.error}`);
    return;
  }
  qc.invalidateQueries({ queryKey: ['hosts'] });
  toast.success('删除成功');
}}>删除</Button>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setCursor(hostsQuery.data?.nextCursor || null)} disabled={!hostsQuery.data?.nextCursor}>下一页</Button>
        </div>
      </CardContent>
    </Card>
  );
}


