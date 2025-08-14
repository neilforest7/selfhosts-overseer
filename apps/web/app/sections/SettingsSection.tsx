"use client";

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

type Settings = { sshConcurrency: number; commandTimeoutSeconds: number; containerUpdateCheckCron: string };

export default function SettingsSection() {
  const qc = useQueryClient();
  const sQuery = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/settings');
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    }
  });

  const [sshConcurrency, setSshConcurrency] = useState(30);
  const [commandTimeoutSeconds, setTimeoutSec] = useState(100);

  useEffect(() => {
    if (sQuery.data) {
      setSshConcurrency(sQuery.data.sshConcurrency);
      setTimeoutSec(sQuery.data.commandTimeoutSeconds);
    }
  }, [sQuery.data]);

  const save = useMutation({
    mutationFn: async (body: Partial<Settings>) => {
      const r = await fetch('http://localhost:3001/api/v1/settings', { method: 'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('保存失败');
      return r.json() as Promise<Settings>;
    },
    onSuccess: () => { toast({ title: '已保存' }); qc.invalidateQueries({ queryKey: ['settings'] }); }
  });

  const validConcurrency = Math.min(100, Math.max(10, sshConcurrency));
  const validTimeout = Math.min(900, Math.max(10, commandTimeoutSeconds));

  return (
    <Card>
      <CardHeader><CardTitle>设置</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 max-w-xs">
          <label className="text-sm">SSH 并发（10–100）</label>
          <Input type="number" value={sshConcurrency} onChange={(e)=>setSshConcurrency(Number(e.target.value))} />
        </div>
        <div className="grid gap-2 max-w-xs">
          <label className="text-sm">命令超时（10–900 秒）</label>
          <Input type="number" value={commandTimeoutSeconds} onChange={(e)=>setTimeoutSec(Number(e.target.value))} />
        </div>
        <div className="flex gap-2">
          <Button onClick={()=>save.mutate({ sshConcurrency: validConcurrency, commandTimeoutSeconds: validTimeout })} disabled={save.isPending}>保存</Button>
          <Button variant="secondary" onClick={()=>{ if (sQuery.data) { setSshConcurrency(sQuery.data.sshConcurrency); setTimeoutSec(sQuery.data.commandTimeoutSeconds); } }}>重置</Button>
        </div>
      </CardContent>
    </Card>
  );
}


