"use client";

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';

type HostItem = { id: string; name: string; address: string; sshUser: string; port?: number; tags?: string[] };

export default function TasksSection() {
  const [command, setCommand] = useState('echo hello');
  const { startOperation } = useTaskDrawerStore(s => s.actions);

  const hostsQuery = useQuery<{ items: HostItem[] }>({
    queryKey: ['hosts', 'all'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/hosts?limit=1000');
      if (!r.ok) throw new Error('加载主机失败');
      return r.json();
    },
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hostFilter, setHostFilter] = useState('');

  useEffect(() => {
    if (hostsQuery.data?.items && hostsQuery.data.items.length > 0 && selected.size === 0) {
      setSelected(new Set(hostsQuery.data.items.map((h) => h.id)));
    }
  }, [hostsQuery.data]);

  const filteredHosts = useMemo(() => {
    const all = hostsQuery.data?.items || [];
    const q = hostFilter.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (h) =>
        h.name.toLowerCase().includes(q) ||
        h.address.toLowerCase().includes(q) ||
        h.sshUser.toLowerCase().includes(q) ||
        (h.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [hostsQuery.data, hostFilter]);

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const all = hostsQuery.data?.items?.map((h) => h.id) || [];
    setSelected(new Set(all));
  };

  const clearAll = () => setSelected(new Set());

  const execMutation = useMutation({
    mutationFn: async (body: { command: string; targets: string[]; opId: string }) => {
      const r = await fetch('http://localhost:3001/api/v1/tasks/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('触发失败');
      return r.json();
    },
  });

  const handleExec = async () => {
    if (!command.trim() || selected.size === 0 || execMutation.isPending) return;
    const opId = await startOperation(`远程执行: ${command}`);
    execMutation.mutate({ command, targets: Array.from(selected), opId });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>任务</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">选择主机</span>
            <Input
              value={hostFilter}
              onChange={(e) => setHostFilter(e.target.value)}
              placeholder="搜索名称/地址/用户/标签"
              className="max-w-xs"
            />
            <Button variant="secondary" onClick={selectAll} disabled={hostsQuery.isLoading}>
              全选
            </Button>
            <Button variant="ghost" onClick={clearAll} disabled={hostsQuery.isLoading}>
              清空
            </Button>
            <span className="text-xs text-muted-foreground">
              已选 {selected.size} / {hostsQuery.data?.items?.length || 0}
            </span>
          </div>
          <div className="max-h-48 overflow-auto rounded-md border p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {filteredHosts.map((h) => (
              <label key={h.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.has(h.id)} onCheckedChange={() => toggleOne(h.id)} />
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-muted-foreground">
                  {h.sshUser}@{h.address}
                  {h.port ? `:${h.port}` : ''}
                </span>
              </label>
            ))}
            {!hostsQuery.isLoading && filteredHosts.length === 0 && (
              <div className="text-xs text-muted-foreground">无匹配主机</div>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="max-w-xl"
              placeholder="输入要执行的命令，例如：uptime"
            />
            <Button onClick={handleExec} disabled={execMutation.isPending || !command.trim() || selected.size === 0}>
              执行
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


