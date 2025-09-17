"use client";

import { Badge } from '@/components/ui/badge';
import { ActivityLog } from '@/lib/types';
import { Container, Network, Server, Settings } from 'lucide-react';
import React from 'react';

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
  HOST_MANAGEMENT: 'bg-blue-100 text-blue-500 dark:bg-blue-500 dark:text-blue-300 border-blue-500',
  CONTAINER_LIFECYCLE: 'bg-green-100 text-green-500 dark:bg-green-500 dark:text-green-300 border-green-500',
  CONTAINER_UPDATE: 'bg-orange-100 text-orange-500 dark:bg-orange-500 dark:text-orange-300 border-orange-500',
  COMPOSE_OPERATION: 'bg-purple-100 text-purple-500 dark:bg-purple-500 dark:text-purple-300 border-purple-500',
  FRP_CONFIGURATION: 'bg-cyan-100 text-cyan-500 dark:bg-cyan-500 dark:text-cyan-300 border-cyan-500',
  REVERSE_PROXY: 'bg-indigo-100 text-indigo-500 dark:bg-indigo-500 dark:text-indigo-300 border-indigo-500',
  SYSTEM_OPERATION: 'bg-gray-100 text-gray-500 dark:bg-gray-500 dark:text-gray-300 border-gray-500',
  AUTOMATION: 'bg-pink-100 text-pink-500 dark:bg-pink-500 dark:text-pink-300 border-pink-500',
  DNS_RESOLUTION: 'bg-yellow-100 text-yellow-500 dark:bg-yellow-500 dark:text-yellow-300 border-yellow-500',
};

const actionColors: Record<string, string> = {
  created: 'bg-green-100 text-green-500 dark:bg-green-700 dark:text-green-300 border-green-500',
  updated: 'bg-green-100 text-green-500 dark:bg-green-700 dark:text-green-300 border-green-500',
  deleted: 'bg-red-100 text-red-500 dark:bg-red-700 dark:text-red-300 border-red-500',
  started: 'bg-green-100 text-green-500 dark:bg-green-700 dark:text-green-300 border-green-500',
  stopped: 'bg-red-100 text-red-500 dark:bg-red-700 dark:text-red-300 border-red-500',
  restarted: '',
  discovered: 'bg-green-100 text-green-500 dark:bg-green-700 dark:text-green-300 border-green-500',
  state_changed: '',
  resolved: '',
  failed: 'bg-red-100 text-red-500 dark:bg-red-700 dark:text-red-300 border-red-500',
  timeout: 'bg-red-100 text-red-500 dark:bg-red-700 dark:text-red-300 border-red-500',
  no_record: 'bg-red-100 text-red-500 dark:bg-red-700 dark:text-red-300 border-red-500',
  unknown: '',
};

function getActionColor(action: string) {
  return actionColors[action] || '';
}

function formatTimestamp(ts: string) {
  return formatDistanceToNow(new Date(ts));
}

export interface ActivityLogListProps {
  activities: ActivityLog[] | undefined | null;
}

export function ActivityLogList({ activities }: ActivityLogListProps) {
  if (!activities || activities.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No recent activities
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {activities.map((activity, index) => (
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
            <div className="flex flex-end items-center gap-2 mb-1">
              <Badge 
                className={categoryColors[activity.category]} 
                variant={'outline'}>
                  {activity.category.toUpperCase().replaceAll("_", " ")}
              </Badge>
              <Badge 
                variant="outline" 
                className={`text-zinc-500 text-xs px-2 ${getActionColor(activity.action)}`}
              >
                {activity.action.toUpperCase().replaceAll("_", " ")}
              </Badge>
              {activity.hostName && (
                <Badge variant="outline" className="text-zinc-500 text-xs px-2">
                  {activity.hostName}
                </Badge>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default ActivityLogList;


