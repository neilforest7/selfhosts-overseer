"use client";

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { ActivityLog, ActivityCategory, ActivityLogQueryParams, ActivityLogResponse } from '@/lib/types';
import { Search, Filter, RefreshCw, Clock, Server, Container, Network, Settings } from 'lucide-react';

// Simple time formatting utility
function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

const categoryIcons: Record<ActivityCategory, React.ReactNode> = {
  HOST_MANAGEMENT: <Server className="h-4 w-4" />,
  CONTAINER_LIFECYCLE: <Container className="h-4 w-4" />,
  CONTAINER_UPDATE: <Container className="h-4 w-4" />,
  COMPOSE_OPERATION: <Container className="h-4 w-4" />,
  FRP_CONFIGURATION: <Network className="h-4 w-4" />,
  REVERSE_PROXY: <Network className="h-4 w-4" />,
  SYSTEM_OPERATION: <Settings className="h-4 w-4" />,
  AUTOMATION: <Settings className="h-4 w-4" />,
};

const categoryColors: Record<ActivityCategory, string> = {
  HOST_MANAGEMENT: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  CONTAINER_LIFECYCLE: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  CONTAINER_UPDATE: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  COMPOSE_OPERATION: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  FRP_CONFIGURATION: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
  REVERSE_PROXY: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300',
  SYSTEM_OPERATION: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
  AUTOMATION: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300',
};

const actionColors: Record<string, string> = {
  created: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  updated: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  deleted: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  started: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  stopped: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
  restarted: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  discovered: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  state_changed: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
};

async function fetchActivityLogs(params: ActivityLogQueryParams): Promise<ActivityLogResponse> {
  const searchParams = new URLSearchParams();
  
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/v1/activity-logs?${searchParams}`);
  if (!response.ok) {
    throw new Error('Failed to fetch activity logs');
  }
  return response.json();
}

interface ActivityLogSectionProps {
  hostId?: string;
  limit?: number;
  showFilters?: boolean;
  title?: string;
}

export function ActivityLogSection({ 
  hostId, 
  limit = 50, 
  showFilters = true, 
  title = "Activity Log" 
}: ActivityLogSectionProps) {
  const [filters, setFilters] = useState<ActivityLogQueryParams>({
    hostId,
    limit,
    offset: 0,
  });
  const [search, setSearch] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['activity-logs', filters],
    queryFn: () => fetchActivityLogs(filters),
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  const handleFilterChange = useCallback((key: keyof ActivityLogQueryParams, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      offset: 0, // Reset offset when filters change
    }));
  }, []);

  const handleSearch = useCallback(() => {
    handleFilterChange('search', search);
  }, [search, handleFilterChange]);

  const loadMore = useCallback(() => {
    if (data?.hasMore) {
      setFilters(prev => ({
        ...prev,
        offset: (prev.offset || 0) + (prev.limit || 50),
      }));
    }
  }, [data?.hasMore]);

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return {
      relative: formatDistanceToNow(date),
      absolute: date.toLocaleString(),
    };
  };

  const getActionColor = (action: string) => {
    return actionColors[action] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {title}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {showFilters && (
          <div className="space-y-4 mb-6">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="Search activities..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button onClick={handleSearch} variant="outline" size="sm">
                <Search className="h-4 w-4" />
              </Button>
            </div>
            
            <div className="flex gap-2 flex-wrap">
              <Select
                value={filters.category || 'all'}
                onValueChange={(value) => handleFilterChange('category', value === 'all' ? undefined : value)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  <SelectItem value="HOST_MANAGEMENT">Host Management</SelectItem>
                  <SelectItem value="CONTAINER_LIFECYCLE">Container Lifecycle</SelectItem>
                  <SelectItem value="CONTAINER_UPDATE">Container Updates</SelectItem>
                  <SelectItem value="COMPOSE_OPERATION">Compose Operations</SelectItem>
                  <SelectItem value="FRP_CONFIGURATION">FRP Configuration</SelectItem>
                  <SelectItem value="REVERSE_PROXY">Reverse Proxy</SelectItem>
                  <SelectItem value="SYSTEM_OPERATION">System Operations</SelectItem>
                  <SelectItem value="AUTOMATION">Automation</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={filters.action || 'all'}
                onValueChange={(value) => handleFilterChange('action', value === 'all' ? undefined : value)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="updated">Updated</SelectItem>
                  <SelectItem value="deleted">Deleted</SelectItem>
                  <SelectItem value="started">Started</SelectItem>
                  <SelectItem value="stopped">Stopped</SelectItem>
                  <SelectItem value="restarted">Restarted</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <ScrollArea className="h-[600px]">
          {isLoading && !data && (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin" />
              <span className="ml-2">Loading activities...</span>
            </div>
          )}

          {error && (
            <div className="text-center py-8 text-red-600">
              Failed to load activity logs. Please try again.
            </div>
          )}

          {data && data.items.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              No activities found.
            </div>
          )}

          {data && data.items.length > 0 && (
            <div className="space-y-3">
              {data.items.map((activity, index) => {
                const timeInfo = formatTimestamp(activity.timestamp);
                
                return (
                  <div key={activity.id} className="border rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-900">
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1">
                        {categoryIcons[activity.category]}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={categoryColors[activity.category]}>
                            {activity.category.replace('_', ' ')}
                          </Badge>
                          <Badge variant="outline" className={getActionColor(activity.action)}>
                            {activity.action}
                          </Badge>
                          {activity.hostName && (
                            <Badge variant="secondary">
                              {activity.hostName}
                            </Badge>
                          )}
                        </div>
                        
                        <h4 className="font-medium text-sm mb-1">{activity.title}</h4>
                        
                        {activity.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                            {activity.description}
                          </p>
                        )}
                        
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span title={timeInfo.absolute}>{timeInfo.relative}</span>
                          {activity.resourceName && (
                            <span>Resource: {activity.resourceName}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {data.hasMore && (
                <div className="text-center pt-4">
                  <Button onClick={loadMore} variant="outline" disabled={isLoading}>
                    Load More
                  </Button>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
