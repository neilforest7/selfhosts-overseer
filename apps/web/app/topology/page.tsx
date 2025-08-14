"use client";

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TopologyPage() {
  const [routes, setRoutes] = useState<any[]>([]);
  useEffect(() => {
    // 这里可接入后端生成的拓扑数据；暂用占位
    setRoutes([]);
  }, []);
  return (
    <Card>
      <CardHeader><CardTitle>拓扑</CardTitle></CardHeader>
      <CardContent>
        {routes.length === 0 ? '无路由数据（占位）' : JSON.stringify(routes)}
      </CardContent>
    </Card>
  );
}


