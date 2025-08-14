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
import { toast } from '@/hooks/use-toast';

type Host = { id: string; name: string; address: string; sshUser: string; port?: number; tags?: string[] };

export default function HostsPage() {
  const qc = useQueryClient();
  const [tag, setTag] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<Host> | null>(null);

  const hostsQuery = useQuery<{ items: Host[]; nextCursor: string | null }>({
    queryKey: ['hosts', tag, cursor],
    queryFn: async () => {
      const url = new URL('http://localhost:3001/api/v1/hosts');
      if (tag) url.searchParams.set('tag', tag);
      if (cursor) url.searchParams.set('cursor', cursor);
      url.searchParams.set('limit', '20');
      const r = await fetch(url);
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    }
  });

  const addMutation = useMutation({
    mutationFn: async (body: Partial<Host>) => {
      const r = await fetch('http://localhost:3001/api/v1/hosts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('创建失败');
      return r.json() as Promise<Host>;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hosts'] }); toast({ title: '已创建主机' }); setDialogOpen(false); setEditing(null); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...partial }: Partial<Host> & { id: string }) => {
      const r = await fetch(`http://localhost:3001/api/v1/hosts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(partial) });
      if (!r.ok) throw new Error('更新失败');
      return r.json() as Promise<Host>;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hosts'] }); toast({ title: '已更新主机' }); setDialogOpen(false); setEditing(null); },
  });

  const deleteOne = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`http://localhost:3001/api/v1/hosts/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error('删除失败');
      return r.json() as Promise<{ ok: boolean }>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosts'] }),
  });

  const bulkDelete = async () => {
    const ids = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
    for (const id of ids) {
      // eslint-disable-next-line no-await-in-loop
      await fetch(`http://localhost:3001/api/v1/hosts/${id}`, { method: 'DELETE' });
    }
    toast({ title: `已删除 ${ids.length} 项` });
    setSelected({});
    qc.invalidateQueries({ queryKey: ['hosts'] });
  };

  const allSelected = useMemo(() => {
    const list = hostsQuery.data?.items || [];
    if (list.length === 0) return false;
    return list.every((h) => selected[h.id]);
  }, [hostsQuery.data, selected]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>主机</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="按标签筛选" className="max-w-xs" />
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>新建主机</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing?.id ? '编辑主机' : '新建主机'}</DialogTitle></DialogHeader>
              <div className="grid gap-3">
                <Input placeholder="名称" defaultValue={editing?.name} onChange={(e) => setEditing((p) => ({ ...(p || {}), name: e.target.value }))} />
                <Input placeholder="地址/IP" defaultValue={editing?.address} onChange={(e) => setEditing((p) => ({ ...(p || {}), address: e.target.value }))} />
                <Input placeholder="SSH 用户" defaultValue={editing?.sshUser} onChange={(e) => setEditing((p) => ({ ...(p || {}), sshUser: e.target.value }))} />
                <Input placeholder="端口（可选）" type="number" defaultValue={editing?.port} onChange={(e) => setEditing((p) => ({ ...(p || {}), port: Number(e.target.value) }))} />
                <Input placeholder="标签，逗号分隔" defaultValue={(editing?.tags || []).join(',')} onChange={(e) => setEditing((p) => ({ ...(p || {}), tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }))} />
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
              <TableHead>用户</TableHead>
              <TableHead>标签</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(hostsQuery.data?.items || []).map((h) => (
              <TableRow key={h.id}>
                <TableCell className="text-center"><Checkbox checked={!!selected[h.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [h.id]: v === true }))} /></TableCell>
                <TableCell>{h.name}</TableCell>
                <TableCell className="text-muted-foreground">{h.address}</TableCell>
                <TableCell className="text-muted-foreground">{h.sshUser}</TableCell>
                <TableCell className="space-x-1">{(h.tags || []).map((t) => (<Badge key={t}>{t}</Badge>))}</TableCell>
                <TableCell className="text-right space-x-2">
                  <Button variant="secondary" onClick={() => { setEditing(h); setDialogOpen(true); }}>编辑</Button>
                  <Button variant="destructive" onClick={() => deleteOne.mutate(h.id)}>删除</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setCursor(hostsQuery.data?.nextCursor || null)} disabled={!hostsQuery.data?.nextCursor}>下一页</Button>
        </div>
      </CardContent>
    </Card>
  );
}


