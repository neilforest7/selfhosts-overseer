'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HostStatusIndicator, HostStatus } from '@/components/HostStatusIndicator';
import { useHostConnectivity } from '@/lib/hooks/useHostConnectivity';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { 
  RefreshCw, 
  Clock, 
  Wifi, 
  AlertTriangle, 
  TrendingUp,
  Activity
} from 'lucide-react';

interface HostConnectivityDetailProps {
  hostId: string;
  hostName: string;
}

interface ConnectivityHistoryItem {
  id: string;
  status: HostStatus;
  responseTime?: number;
  errorMessage?: string;
  checkedAt: string;
}

export function HostConnectivityDetail({ hostId, hostName }: HostConnectivityDetailProps) {
  const { 
    hostHistory, 
    getHostConnectivity, 
    checkConnectivity, 
    refetchHostHistory 
  } = useHostConnectivity({ hostId });

  const currentStatus = getHostConnectivity(hostId);
  const history = hostHistory as ConnectivityHistoryItem[] || [];

  // Prepare chart data
  const chartData = history
    .slice(0, 50) // Last 50 checks
    .reverse()
    .map((item, index) => ({
      index,
      responseTime: item.responseTime || 0,
      status: item.status === 'ONLINE' ? 1 : 0,
      timestamp: new Date(item.checkedAt).toLocaleTimeString(),
      fullTimestamp: new Date(item.checkedAt).toLocaleString(),
      errorMessage: item.errorMessage,
    }));

  // Calculate statistics
  const onlineChecks = history.filter(h => h.status === 'ONLINE').length;
  const offlineChecks = history.filter(h => h.status === 'OFFLINE').length;
  const uptime = history.length > 0 ? (onlineChecks / history.length) * 100 : 0;
  
  const responseTimes = history
    .filter(h => h.responseTime && h.status === 'ONLINE')
    .map(h => h.responseTime!);
  
  const avgResponseTime = responseTimes.length > 0 
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length 
    : 0;

  const handleManualCheck = async () => {
    try {
      await checkConnectivity(hostId);
      refetchHostHistory();
    } catch (error) {
      console.error('Failed to check connectivity:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{hostName}</h2>
          <p className="text-muted-foreground">Connectivity Details</p>
        </div>
        <div className="flex items-center gap-2">
          <HostStatusIndicator
            status={currentStatus?.status || 'UNKNOWN'}
            responseTime={currentStatus?.responseTime}
            lastChecked={currentStatus?.lastChecked}
            variant="detailed"
          />
          <Button onClick={handleManualCheck} size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Check Now
          </Button>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Uptime</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{uptime.toFixed(1)}%</div>
            <p className="text-xs text-muted-foreground">
              {onlineChecks} of {history.length} checks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Response</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {avgResponseTime > 0 ? `${Math.round(avgResponseTime)}ms` : 'N/A'}
            </div>
            <p className="text-xs text-muted-foreground">
              From {responseTimes.length} successful checks
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Online Checks</CardTitle>
            <Wifi className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{onlineChecks}</div>
            <p className="text-xs text-muted-foreground">
              Successful connections
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Failed Checks</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{offlineChecks}</div>
            <p className="text-xs text-muted-foreground">
              Connection failures
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Response Time Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Response Time Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="index" 
                  tick={{ fontSize: 12 }}
                />
                <YAxis 
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip 
                  labelFormatter={(value) => `Check #${value}`}
                  formatter={(value: any, name: string) => [
                    name === 'responseTime' ? `${value}ms` : value,
                    name === 'responseTime' ? 'Response Time' : name
                  ]}
                />
                <Line 
                  type="monotone" 
                  dataKey="responseTime" 
                  stroke="#8884d8" 
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status History Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              Status History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="index" 
                  tick={{ fontSize: 12 }}
                />
                <YAxis 
                  domain={[0, 1]}
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => value === 1 ? 'Online' : 'Offline'}
                />
                <Tooltip 
                  labelFormatter={(value) => `Check #${value}`}
                  formatter={(value: any, name: string, props: any) => [
                    value === 1 ? 'Online' : 'Offline',
                    'Status'
                  ]}
                  contentStyle={{ 
                    backgroundColor: 'var(--background)',
                    border: '1px solid var(--border)'
                  }}
                />
                <Area 
                  type="stepAfter" 
                  dataKey="status" 
                  stroke="#82ca9d" 
                  fill="#82ca9d"
                  fillOpacity={0.3}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent History Table */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Connectivity Checks</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {history.slice(0, 20).map((item) => (
              <div 
                key={item.id} 
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <HostStatusIndicator
                    status={item.status}
                    responseTime={item.responseTime}
                    variant="icon-only"
                    showTooltip={false}
                  />
                  <div>
                    <div className="font-medium">
                      {new Date(item.checkedAt).toLocaleString()}
                    </div>
                    {item.errorMessage && (
                      <div className="text-sm text-red-600">
                        {item.errorMessage}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <Badge variant={item.status === 'ONLINE' ? 'default' : 'destructive'}>
                    {item.status}
                  </Badge>
                  {item.responseTime && (
                    <div className="text-sm text-muted-foreground mt-1">
                      {item.responseTime}ms
                    </div>
                  )}
                </div>
              </div>
            ))}
            
            {history.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No connectivity checks found for this host.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
