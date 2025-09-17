"use client";

import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActivityLog, ActivityCategory, ActivityLogQueryParams, ActivityLogResponse } from '@/lib/types';
import { Search, RefreshCw } from 'lucide-react';
import { ActivityLogList } from '@/app/components/ActivityLogList';


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
  title = "活动日志" 
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

  

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex flex-row items-center justify-between">
          <CardTitle>
            {/* <Clock className="h-5 w-5" /> */}
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
                  <SelectItem value="DNS_RESOLUTION">DNS Resolution</SelectItem>
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
            <>
              <ActivityLogList activities={data.items} />
              {data.hasMore && (
                <div className="text-center pt-4">
                  <Button onClick={loadMore} variant="outline" disabled={isLoading}>
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
