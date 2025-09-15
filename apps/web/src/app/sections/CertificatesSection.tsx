"use client";

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Certificate = { id: string; provider: string; cn: string; sans?: string[]; issuer?: string | null; notBefore?: string | null; notAfter?: string | null; autoRenew?: boolean; lastSyncedAt?: string | null };

export default function CertificatesSection() {
  const query = useQuery<Certificate[]>({
    queryKey: ['certificates'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/certificates');
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    }
  });

  const items = query.data || [];
  return (
    <Card>
      <CardHeader><CardTitle>证书</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {items.length === 0 ? '暂无证书' : items.map(c => (
          <div key={c.id} className="border rounded-md p-2 flex items-center justify-between">
            <div className="space-x-2">
              <span className="font-mono text-xs">{c.provider}</span>
              <span>{c.cn}</span>
              {c.sans && c.sans.length ? <span className="text-muted-foreground">SAN: {c.sans.join(', ')}</span> : null}
            </div>
            <div className="text-muted-foreground text-xs">
              {c.issuer ?? '-'} · {c.autoRenew ? '自动续期' : '手动'} · {c.lastSyncedAt ?? '-'}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}


