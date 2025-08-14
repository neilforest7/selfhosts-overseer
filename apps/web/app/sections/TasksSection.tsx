"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import io, { Socket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';

type TaskRun = { id: string; status: 'pending'|'running'|'succeeded'|'failed'; request: { command: string; targets: string[]; opId?: string }; startedAt?: string; finishedAt?: string };
type HostItem = { id: string; name: string; address: string; sshUser: string; port?: number; tags?: string[] };
type LiveLog = { id?: string; stream: 'stdout' | 'stderr' | 'system'; host: string; content: string };

type TaskStreamEvent = {
  eventId: string;
  taskId: string;
  type: 'task-start'|'task-end'|'host-start'|'host-end'|'log';
  stream: 'stdout'|'stderr'|'system';
  ts: number;
  hostId?: string;
  hostLabel?: string;
  content?: string;
};

type TaskLog = { id: string; ts: string; stream: 'stdout' | 'stderr'; hostLabel?: string | null; content: string };

function HistoryItem({ task }: { task: TaskRun }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hostQ, setHostQ] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = async (next?: string | null) => {
    setLoading(true);
    try {
      const url = new URL(`http://localhost:3001/api/v1/tasks/${task.id}/logs`);
      url.searchParams.set('limit', '200');
      if (next) url.searchParams.set('cursor', next);
      const r = await fetch(url);
      if (!r.ok) throw new Error('加载日志失败');
      const j = await r.json() as { logs: TaskLog[]; nextCursor: string | null };
      setLogs(ls => ls.concat(j.logs.map(l => ({ ...l, ts: (l as any).ts } as TaskLog))));
      setCursor(j.nextCursor);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (open && logs.length === 0) { void load(null); } }, [open]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);

  const filtered = useMemo(() => {
    const q = hostQ.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter(l => (l.hostLabel || '').toLowerCase().includes(q));
  }, [logs, hostQ]);

  return (
    <div className="border rounded-md">
      <div className="flex items-center justify-between p-2">
        <div className="space-x-2">
          <span className="font-mono text-xs">{task.id.slice(0,8)}</span>
          <span className="text-sm">{task.request.command}</span>
          <span className="text-xs text-muted-foreground">{task.status} · {task.startedAt?.replace('T',' ').replace('Z','')}</span>
        </div>
        <div className="flex items-center gap-2">
          {open && (
            <Input value={hostQ} onChange={(e)=>setHostQ(e.target.value)} placeholder="按主机筛选，如 name@ip" className="h-8 w-48" />
          )}
          <Button size="sm" variant={open ? 'secondary' : 'default'} onClick={()=>setOpen(o=>!o)}>{open ? '收起' : '展开'}</Button>
        </div>
      </div>
      {open && (
        <div className="px-2 pb-2">
          <div className="bg-muted p-3 rounded-md text-sm max-h-80 overflow-auto space-y-1">
            {filtered.length === 0 && <div className="text-muted-foreground">（暂无日志）</div>}
            {filtered.map((l) => (
              <div key={l.id} className="font-mono break-words">
                {l.hostLabel && <Badge variant="outline" className="mr-2">{l.hostLabel}</Badge>}
                <span className={l.stream === 'stderr' ? 'text-red-600' : ''}>{l.content}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="flex justify-end mt-2">
            <Button size="sm" variant="secondary" onClick={()=>void load(cursor)} disabled={!cursor || loading}>{cursor ? (loading ? '加载中...' : '加载更多') : '已无更多'}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TasksSection() {
  const [task, setTask] = useState<TaskRun | null>(null);
  const [command, setCommand] = useState('echo hello');
  const [logItems, setLogItems] = useState<LiveLog[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  const joinedTaskIdRef = useRef<string | null>(null);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const lastEventIdRef = useRef<string | null>(null);

  const hostsQuery = useQuery<{ items: HostItem[]; nextCursor: string | null}>({
    queryKey: ['hosts', 'all'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/hosts?limit=1000');
      if (!r.ok) throw new Error('加载主机失败');
      return r.json();
    }
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hostFilter, setHostFilter] = useState('');

  // 初次加载默认全选
  useEffect(() => {
    if (hostsQuery.data?.items && hostsQuery.data.items.length > 0 && selected.size === 0) {
      setSelected(new Set(hostsQuery.data.items.map(h => h.id)));
    }
  }, [hostsQuery.data]);

  const filteredHosts = useMemo(() => {
    const all = hostsQuery.data?.items || [];
    const q = hostFilter.trim().toLowerCase();
    if (!q) return all;
    return all.filter(h =>
      h.name.toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q) ||
      h.sshUser.toLowerCase().includes(q) ||
      (h.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }, [hostsQuery.data, hostFilter]);

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const all = hostsQuery.data?.items?.map(h => h.id) || [];
    setSelected(new Set(all));
  };

  const clearAll = () => setSelected(new Set());

  const addItems = useCallback((incoming: LiveLog[]) => {
    if (!incoming || incoming.length === 0) return;
    setLogItems((ls) => {
      return ls.concat(incoming);
    });
  }, []);

  const addEvent = useCallback((e: TaskStreamEvent) => {
    if (!e?.eventId) return;
    if (seenEventIdsRef.current.has(e.eventId)) return;
    seenEventIdsRef.current.add(e.eventId);
    lastEventIdRef.current = e.eventId;
    setLogItems((ls) => ls.concat([{ id: e.eventId, stream: e.stream, host: e.hostLabel || '', content: e.content || '' }]));
  }, []);

  const execMutation = useMutation({
    mutationFn: async (body: { command: string; targets: string[]; opId?: string }) => {
      const r = await fetch('http://localhost:3001/api/v1/tasks/exec', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('触发失败');
      return r.json() as Promise<TaskRun>;
    },
    onMutate: () => {
      addItems([{ stream: 'system', host: '', content: '已提交任务，等待服务端响应...' }]);
    },
    onSuccess: (run) => {
      setTask(run);
      addItems([
        { stream: 'system', host: '', content: `任务已创建：${run.id}` },
        { stream: 'system', host: '', content: '正在建立 WebSocket 连接并订阅任务...' }
      ]);
    },
    onError: (err: any) => {
      addItems([{ stream: 'system', host: '', content: `任务提交失败：${String(err?.message || err)}` }]);
    }
  });

  const hostLabels = useMemo(() => (hostsQuery.data?.items || []).map(h => `${h.name}@${h.address}`), [hostsQuery.data]);

  // no HTTP backfill in structured mode

  // Ensure we are joined before any output is produced by pre-provisioning an opId
  useEffect(() => {
    if (!activeTaskId) return;
    if (joinedTaskIdRef.current === activeTaskId && socketRef.current) return; // already joined
    if (socketRef.current) {
      try { socketRef.current.disconnect(); } catch {}
    }
    const s = io('http://localhost:3001', { transports: ['websocket'] });
    socketRef.current = s;
    s.on('connect', () => {
      s.emit('joinTask', { taskId: activeTaskId, afterId: lastEventIdRef.current || undefined });
      joinedTaskIdRef.current = activeTaskId;
    });
    const onLog = (e: TaskStreamEvent) => { if (e.taskId === activeTaskId) addEvent(e); };
    const onReplayEnd = () => { /* optional marker */ };
    const onEnd = (p: any) => { addItems([{ stream: 'system', host: '', content: `--- 结束: ${JSON.stringify(p)} ---` }]); };
    s.on('task.log', onLog); s.on('task.replayEnd', onReplayEnd); s.on('end', onEnd);
    return () => { s.off('task.log', onLog); s.off('task.replayEnd', onReplayEnd); s.off('end', onEnd); };
  }, [activeTaskId, addEvent, addItems]);

  const handleExec = () => {
    if (!command.trim() || selected.size === 0 || execMutation.isPending) return;
    // Pre-generate opId and join WS before POST to avoid missing early outputs
    const opId = `task_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // reset dedupe state
    seenEventIdsRef.current = new Set();
    lastEventIdRef.current = null;
    setLogItems([]);
    setActiveTaskId(opId);
    addItems([{ stream: 'system', host: '', content: `准备执行（opId=${opId}）...` }]);
    execMutation.mutate({ command, targets: Array.from(selected), opId });
  };

  // 自动滚动到底部
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logItems.length]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const historyQuery = useQuery<{ items: TaskRun[]; nextCursor: string | null }>({
    queryKey: ['tasks-history', historyCursor],
    queryFn: async () => {
      const url = new URL('http://localhost:3001/api/v1/tasks');
      url.searchParams.set('limit', '20');
      if (historyCursor) url.searchParams.set('cursor', historyCursor);
      const r = await fetch(url); if (!r.ok) throw new Error('加载失败');
      return r.json();
    }
  });

  return (
    <Card>
      <CardHeader><CardTitle>任务</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">选择主机</span>
            <Input value={hostFilter} onChange={(e)=>setHostFilter(e.target.value)} placeholder="搜索名称/地址/用户/标签" className="max-w-xs" />
            <Button variant="secondary" onClick={selectAll} disabled={hostsQuery.isLoading}>全选</Button>
            <Button variant="ghost" onClick={clearAll} disabled={hostsQuery.isLoading}>清空</Button>
            <span className="text-xs text-muted-foreground">已选 {selected.size} / {hostsQuery.data?.items?.length || 0}</span>
          </div>
          <div className="max-h-48 overflow-auto rounded-md border p-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(filteredHosts).map(h => (
              <label key={h.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.has(h.id)} onCheckedChange={() => toggleOne(h.id)} />
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-muted-foreground">{h.sshUser}@{h.address}{h.port ? `:${h.port}` : ''}</span>
              </label>
            ))}
            {(!hostsQuery.isLoading && filteredHosts.length === 0) && (
              <div className="text-xs text-muted-foreground">无匹配主机</div>
            )}
          </div>
          <div className="flex gap-2 items-center">
            <Input value={command} onChange={(e)=>setCommand(e.target.value)} className="max-w-xl" placeholder="输入要执行的命令，例如：uptime" />
            <Button onClick={handleExec} disabled={execMutation.isPending || !command.trim() || selected.size === 0}>
              执行
            </Button>
          </div>
        </div>
        <div className="text-xs text-muted-foreground">提示：命令将按全局并发与超时设置并发执行；stderr 以红色显示；使用“历史”可展开并按主机筛选日志。</div>
        <Tabs defaultValue="running">
          <TabsList>
            <TabsTrigger value="running">实时</TabsTrigger>
            <TabsTrigger value="history">历史</TabsTrigger>
          </TabsList>
          <TabsContent value="running">
            <div className="bg-muted p-3 rounded-md text-sm min-h-48 max-h-96 overflow-auto space-y-1">
              {logItems.length === 0 && <div className="text-muted-foreground">（等待日志）</div>}
              {logItems.map((l, idx) => (
                <div key={idx} className="font-mono break-words">
                  {l.host && <Badge variant="outline" className="mr-2">{l.host}</Badge>}
                  <span className={l.stream === 'stderr' ? 'text-red-600' : (l.stream === 'system' ? 'text-muted-foreground italic' : '')}>{l.content}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </TabsContent>
          <TabsContent value="history">
            <div className="space-y-2">
              {(historyQuery.data?.items || []).map(t => (
                <HistoryItem key={t.id} task={t} />
              ))}
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => setHistoryCursor(historyQuery.data?.nextCursor || null)} disabled={!historyQuery.data?.nextCursor}>下一页</Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}


