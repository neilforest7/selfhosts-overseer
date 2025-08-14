"use client";

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type ContainerItem = { id: string; name: string; image: string; tag?: string; updateAvailable?: boolean; hostId: string };

export default function ContainersPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [updateOnly, setUpdateOnly] = useState(false);

  const listQuery = useQuery<{ items: ContainerItem[] }>({
    queryKey: ['containers', q, updateOnly],
    queryFn: async () => {
      const url = new URL('http://localhost:3001/api/v1/containers');
      if (q) url.searchParams.set('q', q);
      if (updateOnly) url.searchParams.set('updateAvailable', 'true');
      const r = await fetch(url);
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    }
  });

  const discover = useMutation({
    mutationFn: async (hostId: string) => {
      // 此处可以先调用 /api/v1/hosts 获取 host 信息，简化直接只传 id
      const r = await fetch('http://localhost:3001/api/v1/containers/discover', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: hostId } }) });
      if (!r.ok) throw new Error('发现失败');
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] })
  });

  const checkUpdates = useMutation({
    mutationFn: async (hostId: string) => {
      const r = await fetch('http://localhost:3001/api/v1/containers/check-updates', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ host: { id: hostId } }) });
      if (!r.ok) throw new Error('检查失败');
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['containers'] })
  });

  return (
    <Card>
      <CardHeader><CardTitle>容器</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2 items-center">
          <Input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="搜索容器/镜像" className="max-w-xs" />
          <Button variant={updateOnly ? 'secondary' : 'default'} onClick={()=>setUpdateOnly(v=>!v)}>{updateOnly ? '显示全部' : '仅看可更新'}</Button>
          <div className="ml-auto flex gap-2">
            <Button onClick={()=>discover.mutate('all')}>发现（全部）</Button>
            <Button onClick={()=>checkUpdates.mutate('all')}>检查更新（全部）</Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>镜像</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>更新</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(listQuery.data?.items || []).map(c => (
              <TableRow key={c.id}>
                <TableCell>{c.name}</TableCell>
                <TableCell className="text-muted-foreground">{c.image}</TableCell>
                <TableCell>{c.tag}</TableCell>
                <TableCell>{c.updateAvailable ? '可更新' : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}


