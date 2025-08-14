"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TopologySection() {
  const [routes, setRoutes] = useState<any[]>([]);
  const [hostFilter, setHostFilter] = useState('');
  const [domainQ, setDomainQ] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const url = new URL('http://localhost:3001/api/v1/reverse-proxy/routes');
        if (hostFilter) url.searchParams.set('hostId', hostFilter);
        const r = await fetch(url);
        const data = await r.json();
        const list = (data || []) as any[];
        setRoutes(domainQ ? list.filter(x => String(x.domain).includes(domainQ)) : list);
      } catch {
        setRoutes([]);
      }
    })();
  }, [hostFilter, domainQ]);
  return (
    <Card>
      <CardHeader><CardTitle>拓扑</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <input className="border rounded px-2 py-1 text-sm" placeholder="按 hostId 过滤" value={hostFilter} onChange={(e)=>setHostFilter(e.target.value)} />
          <input className="border rounded px-2 py-1 text-sm" placeholder="按域名搜索" value={domainQ} onChange={(e)=>setDomainQ(e.target.value)} />
        </div>
        {routes.length === 0 ? '无路由数据' : (
          <div className="text-sm space-y-1">
            {routes.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between border rounded-md p-2">
                <div className="space-x-2">
                  <span className="font-mono text-xs">{r.type}</span>
                  <span>{r.domain}</span>
                  <span className="text-muted-foreground">→ {r.forwardHost}:{r.forwardPort ?? '-'}</span>
                </div>
                <div className="text-muted-foreground text-xs">
                  {r.provider} · {r.vpsName ?? '-'} · {r.enabled ? '启用' : '禁用'}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


