"use client";

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActivityLog } from '@/lib/types';
import { useActivityLogSocket } from '@/lib/hooks/useActivityLogSocket';
import { apiClient } from '@/src/lib/api-client';
import { Clock, Wifi, WifiOff } from 'lucide-react';
import { useState, useCallback } from 'react';
import { ActivityLogList } from '@/app/components/ActivityLogList';

async function fetchRecentActivities(): Promise<ActivityLog[]> {
  const response = await apiClient.get('/api/v1/activity-logs/recent?limit=10');
  if (!response.success) {
    throw new Error('Failed to fetch recent activities');
  }
  return response.data as ActivityLog[];
}

interface ActivityLogWidgetProps {
  className?: string;
}

export function ActivityLogWidget({ className }: ActivityLogWidgetProps) {
  const [realtimeActivities, setRealtimeActivities] = useState<ActivityLog[]>([]);
  const [useRealtime, setUseRealtime] = useState(true);

  const { data: activities, isLoading, error, refetch } = useQuery({
    queryKey: ['recent-activities'],
    queryFn: fetchRecentActivities,
    refetchInterval: useRealtime ? false : 30000, // Only refetch if not using realtime
    enabled: !useRealtime, // Only fetch if realtime is disabled
  });

  const handleNewActivity = useCallback((activity: ActivityLog) => {
    setRealtimeActivities(prev => [activity, ...prev.slice(0, 9)]); // Keep latest 10
  }, []);

  const handleHistoryReceived = useCallback((activities: ActivityLog[]) => {
    setRealtimeActivities(activities);
  }, []);

  const { isConnected, activities: socketActivities } = useActivityLogSocket({
    onNewActivity: handleNewActivity,
    onHistoryReceived: handleHistoryReceived,
  });

  // Use realtime activities if connected, otherwise fallback to API data
  // Ensure unique activities by ID
  const rawActivities = useRealtime && isConnected ? realtimeActivities : activities;
  const displayActivities = rawActivities ?
    rawActivities.filter((activity, index, arr) =>
      arr.findIndex(a => a.id === activity.id) === index
    ) : [];

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" />
            Recent Activity
            {useRealtime && (
              <div className="flex items-center gap-1">
                {isConnected ? (
                  <Wifi className="h-3 w-3 text-green-500" />
                ) : (
                  <WifiOff className="h-3 w-3 text-red-500" />
                )}
              </div>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[620px]">
          {(isLoading && !useRealtime) && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              <span className="ml-2 text-sm">Loading...</span>
            </div>
          )}

          {(error && !useRealtime) && (
            <div className="text-center py-8 text-red-600 text-sm">
              Failed to load activities
            </div>
          )}

          {(!isConnected && useRealtime) && (
            <div className="text-center py-8 text-yellow-600 text-sm">
              Connecting to real-time updates...
            </div>
          )}
          <ActivityLogList activities={displayActivities} />
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
