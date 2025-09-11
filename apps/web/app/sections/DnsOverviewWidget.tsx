"use client";

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/src/lib/api-client';
import { Globe, CheckCircle, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';

interface DnsStats {
  totalRecords: number;
  enabledRecords: number;
  statusDistribution: Record<string, number>;
  last24HourSuccess: number;
  last24HourFailures: number;
}

async function fetchDnsStats(): Promise<DnsStats> {
  const response = await apiClient.get('/api/v1/dns/stats');
  if (!response.success) {
    throw new Error('Failed to fetch DNS stats');
  }
  return response.data as DnsStats;
}

export function DnsOverviewWidget() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['dns-overview-stats'],
    queryFn: fetchDnsStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">DNS Monitoring</CardTitle>
          <Globe className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="h-6 bg-muted animate-pulse rounded" />
            <div className="h-4 bg-muted animate-pulse rounded w-3/4" />
            <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">DNS Monitoring</CardTitle>
          <Globe className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            <span>Failed to load DNS stats</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const successRate = stats.last24HourSuccess + stats.last24HourFailures > 0
    ? (stats.last24HourSuccess / (stats.last24HourSuccess + stats.last24HourFailures)) * 100
    : 0;

  const healthyRecords = stats.statusDistribution?.RESOLVED || 0;
  const failedRecords = (stats.statusDistribution?.FAILED || 0) + 
                        (stats.statusDistribution?.TIMEOUT || 0) + 
                        (stats.statusDistribution?.NO_RECORD || 0);

  const getHealthStatus = () => {
    if (stats.enabledRecords === 0) return { label: 'No Records', color: 'secondary' };
    if (successRate >= 95) return { label: 'Healthy', color: 'default' };
    if (successRate >= 90) return { label: 'Warning', color: 'secondary' };
    return { label: 'Critical', color: 'destructive' };
  };

  const healthStatus = getHealthStatus();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">DNS Monitoring</CardTitle>
        <Globe className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-2xl font-bold">{stats.enabledRecords}</div>
          <Badge variant={healthStatus.color as any}>
            {healthStatus.label}
          </Badge>
        </div>
        
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Success Rate (24h)</span>
            <span className="font-medium">{successRate.toFixed(1)}%</span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <CheckCircle className="h-3 w-3 text-green-500" />
              <span className="text-muted-foreground">Healthy</span>
            </div>
            <span className="font-medium">{healthyRecords}</span>
          </div>
          
          {failedRecords > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <XCircle className="h-3 w-3 text-red-500" />
                <span className="text-muted-foreground">Failed</span>
              </div>
              <span className="font-medium text-red-600">{failedRecords}</span>
            </div>
          )}
        </div>

        <div className="pt-2 border-t">
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full justify-between text-xs"
            onClick={() => window.location.hash = 'dns'}
          >
            <span>View DNS Management</span>
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
