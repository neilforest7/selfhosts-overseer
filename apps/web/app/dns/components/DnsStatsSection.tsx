'use client';

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Globe, CheckCircle, XCircle, Clock, Activity } from 'lucide-react';

interface DnsStats {
  totalRecords: number;
  enabledRecords: number;
  statusDistribution: Record<string, number>;
  providerDistribution: Array<{ providerId: string; _count: number }>;
  recentResolutions: number;
  last24HourSuccess: number;
  last24HourFailures: number;
  isFilteringEnabled?: boolean;
  standardRecordTypes?: string[] | null;
}

async function fetchDnsStats(): Promise<DnsStats> {
  const response = await fetch('/api/v1/dns/stats');
  if (!response.ok) {
    throw new Error('Failed to fetch DNS stats');
  }
  return response.json();
}

export function DnsStatsSection() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['dns-stats'],
    queryFn: fetchDnsStats,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-muted animate-pulse rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">Failed to load DNS statistics</p>
        </CardContent>
      </Card>
    );
  }

  const successRate = stats.last24HourSuccess + stats.last24HourFailures > 0
    ? (stats.last24HourSuccess / (stats.last24HourSuccess + stats.last24HourFailures)) * 100
    : 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Total Records
            {stats.isFilteringEnabled && (
              <span className="ml-2 text-xs text-blue-600 font-normal">
                filtered
              </span>
            )}
          </CardTitle>
          <Globe className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.totalRecords}</div>
          <p className="text-xs text-muted-foreground">
            {stats.enabledRecords} enabled
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">24h Success Rate</CardTitle>
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{successRate.toFixed(1)}%</div>
          <p className="text-xs text-muted-foreground">
            {stats.last24HourSuccess} successful / {stats.last24HourFailures} failed
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Resolution Status
            {stats.isFilteringEnabled && (
              <span className="ml-2 text-xs text-blue-600 font-normal">
                filtered
              </span>
            )}
          </CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(stats.statusDistribution).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <Badge
                  variant={status === 'RESOLVED' ? 'default' : status === 'FAILED' ? 'destructive' : 'outline'}
                  className="text-xs"
                >
                  {status === 'NO_RECORD' ? 'Unresolved' : status === 'RESOLVED'? 'Resolved' : status}
                </Badge>
                <span className="text-sm font-medium">{count}</span>
              </div>
            ))}
            {/* {stats.isFilteringEnabled && stats.standardRecordTypes && (
              <div className="mt-3 pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  Showing: {stats.standardRecordTypes.join(', ')} records only
                </p>
              </div>
            )} */}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Recent Activity
            {stats.isFilteringEnabled && (
              <span className="ml-2 text-xs text-blue-600 font-normal">
                filtered
              </span>
            )}
          </CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.recentResolutions}</div>
          <p className="text-xs text-muted-foreground">
            resolutions in last 24h
            {/* {stats.isFilteringEnabled && (
              <span className="ml-1 text-blue-600">
                (filtered)
              </span>
            )} */}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
