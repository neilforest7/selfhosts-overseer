"use client";

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function ObservabilityPage() {
  const [grafanaUrl, setGrafanaUrl] = useState('http://localhost:3000/dashboards');
  const [lokiUrl, setLokiUrl] = useState('http://localhost:3000/explore?left=(datasource:%27Loki%27)');
  return (
    <Card>
      <CardHeader><CardTitle>观测</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 max-w-xl">
          <label className="text-sm">Grafana</label>
          <Input value={grafanaUrl} onChange={(e)=>setGrafanaUrl(e.target.value)} />
          <iframe src={grafanaUrl} className="w-full h-[60vh] rounded-md border" />
        </div>
        <div className="grid gap-2 max-w-xl">
          <label className="text-sm">Loki 日志（Explore）</label>
          <Input value={lokiUrl} onChange={(e)=>setLokiUrl(e.target.value)} />
          <iframe src={lokiUrl} className="w-full h-[60vh] rounded-md border" />
        </div>
      </CardContent>
    </Card>
  );
}


