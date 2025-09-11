"use client";

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActivityLog } from '@/lib/types';
import { useActivityLogSocket } from '@/lib/hooks/useActivityLogSocket';
import { apiClient } from '@/src/lib/api-client';
import { Clock, Server, Container, Network, Settings, ExternalLink, Wifi, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { useState, useCallback } from 'react';

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

const categoryIcons: Record<string, React.ReactNode> = {
  HOST_MANAGEMENT: <Server className="h-3 w-3" />,
  CONTAINER_LIFECYCLE: <Container className="h-3 w-3" />,
  CONTAINER_UPDATE: <Container className="h-3 w-3" />,
  COMPOSE_OPERATION: <Container className="h-3 w-3" />,
  FRP_CONFIGURATION: <Network className="h-3 w-3" />,
  REVERSE_PROXY: <Network className="h-3 w-3" />,
  SYSTEM_OPERATION: <Settings className="h-3 w-3" />,
  AUTOMATION: <Settings className="h-3 w-3" />,
};

const categoryColors: Record<string, string> = {
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

  const getActionColor = (action: string) => {
    return actionColors[action] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300';
  };

  const formatTimestamp = (timestamp: string) => {
    return formatDistanceToNow(new Date(timestamp));
  };

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
          {/* <Link
            href="/activity"
            className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
          >
            View all
            <ExternalLink className="h-3 w-3" />
          </Link> */}
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

          {displayActivities && displayActivities.length === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">
              No recent activities
            </div>
          )}

          {displayActivities && displayActivities.length > 0 && (
            <div className="space-y-2">
              {displayActivities.map((activity, index) => (
                <div key={`${activity.id}-${index}`} className="flex items-start p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900">
                  <div className="flex-1 min-w-0 space-y-2 items-center m-2">
                    <div className='flex space-x-4 justify-between pr-2'>
                      <div className='flex gap-2 items-center'>
                        <div>
                          {categoryIcons[activity.category] || <Settings className="h-4 w-4" />}
                        </div>
                        <p className="text-sm font-medium leading-tight">
                          {activity.title}
                        </p>

                      </div>
                      <span className="text-xs text-gray-500">
                        {formatTimestamp(activity.timestamp)}
                      </span>                      
                    </div>
                    <div className="flex space-x-4">

                      {activity.description && (
                        <p className="text-xs text-gray-400 dark:text-gray-400 leading-tight">
                          {activity.description}
                        </p>
                      )}
                      {activity.resourceName && (
                        <span className="text-xs text-gray-500 truncate max-w-[100px]">
                          {activity.resourceName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mb-1">
                      <Badge className={categoryColors[activity.category]}>
                        {activity.category.toUpperCase()}
                      </Badge>
                      <Badge 
                        variant="outline" 
                        className={`text-xs px-2 ${getActionColor(activity.action)}`}
                      >
                        {activity.action.toUpperCase()}
                      </Badge>
                      {activity.hostName && (
                        <Badge variant="secondary" className="text-xs px-2">
                          {activity.hostName}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
