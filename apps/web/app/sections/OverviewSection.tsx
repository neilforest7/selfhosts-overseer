"use client";

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActivityLogWidget } from './ActivityLogWidget';
import { Server, Container, Network, Activity, TrendingUp, AlertTriangle } from 'lucide-react';

interface SystemStats {
  hosts: {
    total: number;
    online: number;
    offline: number;
  };
  containers: {
    total: number;
    running: number;
    stopped: number;
    updateAvailable: number;
  };
  activities: {
    total: number;
    last24h: number;
  };
}

async function fetchSystemStats(): Promise<SystemStats> {
  // Fetch hosts
  const hostsResponse = await fetch('/api/v1/hosts');
  const hostsData = await hostsResponse.json();
  
  // Fetch containers
  const containersResponse = await fetch('/api/v1/containers');
  const containersData = await containersResponse.json();
  
  // Fetch activity stats
  const activityResponse = await fetch('/api/v1/activity-logs/stats?days=1');
  const activityData = await activityResponse.json();

  return {
    hosts: {
      total: hostsData.items?.length || 0,
      online: hostsData.items?.filter((h: any) => h.status === 'online')?.length || 0,
      offline: hostsData.items?.filter((h: any) => h.status === 'offline')?.length || 0,
    },
    containers: {
      total: containersData.items?.length || 0,
      running: containersData.items?.filter((c: any) => c.state === 'running')?.length || 0,
      stopped: containersData.items?.filter((c: any) => c.state !== 'running')?.length || 0,
      updateAvailable: containersData.items?.filter((c: any) => c.updateAvailable)?.length || 0,
    },
    activities: {
      total: activityData.total || 0,
      last24h: activityData.total || 0,
    },
  };
}

function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon, 
  trend,
  className = "" 
}: { 
  title: string; 
  value: number | string; 
  subtitle?: string; 
  icon: React.ReactNode; 
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            {trend === 'up' && <TrendingUp className="h-3 w-3 text-green-500" />}
            {trend === 'down' && <TrendingUp className="h-3 w-3 text-red-500 rotate-180" />}
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function OverviewSection() {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['system-stats'],
    queryFn: fetchSystemStats,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="space-y-0 pb-2">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              </CardHeader>
              <CardContent>
                <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-2/3"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Failed to load overview</h3>
          <p className="text-gray-600">Please try refreshing the page</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Hosts"
          value={stats?.hosts.total || 0}
          subtitle={`${stats?.hosts.online || 0} online, ${stats?.hosts.offline || 0} offline`}
          icon={<Server className="h-4 w-4 text-muted-foreground" />}
          trend={stats?.hosts.online === stats?.hosts.total ? 'up' : 'neutral'}
        />
        
        <StatCard
          title="Containers"
          value={stats?.containers.total || 0}
          subtitle={`${stats?.containers.running || 0} running, ${stats?.containers.stopped || 0} stopped`}
          icon={<Container className="h-4 w-4 text-muted-foreground" />}
          trend={stats?.containers.running > 0 ? 'up' : 'neutral'}
        />
        
        <StatCard
          title="Updates Available"
          value={stats?.containers.updateAvailable || 0}
          subtitle="Container updates pending"
          icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />}
          trend={stats?.containers.updateAvailable > 0 ? 'down' : 'up'}
        />
        
        <StatCard
          title="Activities (24h)"
          value={stats?.activities.last24h || 0}
          subtitle="System activities today"
          icon={<Activity className="h-4 w-4 text-muted-foreground" />}
          trend="neutral"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Activity Log Widget - Takes up more space */}
        <div className="lg:col-span-2">
          <ActivityLogWidget />
        </div>

        {/* Quick Actions or Additional Widgets */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <a 
                href="#hosts" 
                className="block p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Server className="h-4 w-4" />
                  <div>
                    <div className="font-medium text-sm">Manage Hosts</div>
                    <div className="text-xs text-gray-600">Add or configure hosts</div>
                  </div>
                </div>
              </a>
              
              <a 
                href="#containers" 
                className="block p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Container className="h-4 w-4" />
                  <div>
                    <div className="font-medium text-sm">View Containers</div>
                    <div className="text-xs text-gray-600">Monitor container status</div>
                  </div>
                </div>
              </a>
              
              <a
                href="#topology"
                className="block p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Network className="h-4 w-4" />
                  <div>
                    <div className="font-medium text-sm">Network Topology</div>
                    <div className="text-xs text-gray-600">Visualize connections</div>
                  </div>
                </div>
              </a>

              <a
                href="#activity"
                className="block p-3 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Activity className="h-4 w-4" />
                  <div>
                    <div className="font-medium text-sm">Activity Log</div>
                    <div className="text-xs text-gray-600">View system activities</div>
                  </div>
                </div>
              </a>
            </CardContent>
          </Card>

          {/* System Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">System Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">Hosts Online</span>
                <Badge variant={stats?.hosts.online === stats?.hosts.total ? "default" : "destructive"}>
                  {stats?.hosts.online}/{stats?.hosts.total}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between">
                <span className="text-sm">Containers Running</span>
                <Badge variant="default">
                  {stats?.containers.running}/{stats?.containers.total}
                </Badge>
              </div>
              
              {stats?.containers.updateAvailable > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Updates Available</span>
                  <Badge variant="secondary">
                    {stats.containers.updateAvailable}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
