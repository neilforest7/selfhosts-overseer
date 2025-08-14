"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import io, { Socket } from 'socket.io-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type TaskRun = { id: string; status: 'pending'|'running'|'succeeded'|'failed'; request: { command: string; targets: string[] }; startedAt?: string; finishedAt?: string };

export default function TasksSection() {
  const [task, setTask] = useState<TaskRun | null>(null);
  const [command, setCommand] = useState('echo hello');
  const [logs, setLogs] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const execMutation = useMutation({
    mutationFn: async (body: { command: string; targets: string[] }) => {
      const r = await fetch('http://localhost:3001/api/v1/tasks/exec', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('触发失败');
      return r.json() as Promise<TaskRun>;
    },
    onSuccess: (run) => { setTask(run); setLogs([]); }
  });

  useEffect(() => {
    if (!task?.id) return;
    const s = io('http://localhost:3001', { transports: ['websocket'] });
    socketRef.current = s;
    s.on('connect', () => { s.emit('joinTask', { taskId: task.id }); });
    const onData = (d: string) => setLogs((ls) => [...ls, d]);
    const onErr = (d: string) => setLogs((ls) => [...ls, `[stderr] ${d}`]);
    const onEnd = (p: any) => setLogs((ls) => [...ls, `--- 结束: ${JSON.stringify(p)} ---`]);
    s.on('data', onData); s.on('stderr', onErr); s.on('end', onEnd);
    return () => { s.off('data', onData); s.off('stderr', onErr); s.off('end', onEnd); s.disconnect(); };
  }, [task?.id]);

  const logText = useMemo(() => logs.join('\n'), [logs]);
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
        <div className="flex gap-2">
          <Input value={command} onChange={(e)=>setCommand(e.target.value)} className="max-w-xl" />
          <Button onClick={()=>execMutation.mutate({ command, targets: [] })} disabled={execMutation.isPending}>执行</Button>
        </div>
        <Tabs value="running">
          <TabsContent value="running">
            <pre className="bg-muted p-3 rounded-md whitespace-pre-wrap text-sm min-h-48">{logText || '（等待日志）'}</pre>
          </TabsContent>
          <TabsContent value="history">
            <div className="space-y-2">
              {(historyQuery.data?.items || []).map(t => (
                <div key={t.id} className="text-sm flex items-center justify-between border rounded-md p-2">
                  <div className="space-x-2">
                    <span className="font-mono text-xs">{t.id.slice(0,8)}</span>
                    <span>{t.request.command}</span>
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {t.status} · {t.startedAt?.replace('T',' ').replace('Z','')}
                  </div>
                </div>
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


