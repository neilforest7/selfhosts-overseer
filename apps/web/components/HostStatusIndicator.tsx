'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Wifi, 
  WifiOff, 
  AlertCircle,
  Loader2
} from 'lucide-react';

export type HostStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

export interface HostStatusIndicatorProps {
  status: HostStatus;
  responseTime?: number;
  lastChecked?: string | Date;
  lastOnline?: string | Date;
  lastOffline?: string | Date;
  errorMessage?: string;
  variant?: 'default' | 'compact' | 'detailed' | 'icon-only';
  showTooltip?: boolean;
  className?: string;
}

const statusConfig = {
  ONLINE: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900',
    borderColor: 'border-green-200 dark:border-green-800',
    label: 'Online',
    description: 'Host is reachable and responding',
  },
  OFFLINE: {
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900',
    borderColor: 'border-red-200 dark:border-red-800',
    label: 'Offline',
    description: 'Host is not reachable',
  },
  UNKNOWN: {
    icon: AlertCircle,
    color: 'text-gray-600',
    bgColor: 'bg-gray-100 dark:bg-gray-900',
    borderColor: 'border-gray-200 dark:border-gray-800',
    label: 'Unknown',
    description: 'Host status has not been checked',
  },
};

function formatResponseTime(responseTime?: number): string {
  if (!responseTime) return 'N/A';
  if (responseTime < 1000) return `${responseTime}ms`;
  return `${(responseTime / 1000).toFixed(1)}s`;
}

function formatLastChecked(date?: string | Date): string {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return `${Math.floor(diffMins / 1440)}d ago`;
}

function formatDateTime(date?: string | Date): string {
  if (!date) return 'Never';
  return new Date(date).toLocaleString();
}

export function HostStatusIndicator({
  status,
  responseTime,
  lastChecked,
  lastOnline,
  lastOffline,
  errorMessage,
  variant = 'default',
  showTooltip = true,
  className,
}: HostStatusIndicatorProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  const tooltipContent = (
    <div className="space-y-2 text-sm">
      <div className="font-medium">{config.label}</div>
      <div className="text-muted-foreground">{config.description}</div>
      
      {status === 'ONLINE' && responseTime && (
        <div>Response time: {formatResponseTime(responseTime)}</div>
      )}
      
      {status === 'OFFLINE' && errorMessage && (
        <div className="text-red-400">Error: {errorMessage}</div>
      )}
      
      <div className="border-t pt-2 space-y-1">
        <div>Last checked: {formatDateTime(lastChecked)}</div>
        {lastOnline && (
          <div>Last online: {formatDateTime(lastOnline)}</div>
        )}
        {lastOffline && (
          <div>Last offline: {formatDateTime(lastOffline)}</div>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (variant) {
      case 'icon-only':
        return (
          <Icon className={cn('h-4 w-4', config.color)} />
        );

      case 'compact':
        return (
          <div className="flex items-center gap-1">
            <Icon className={cn('h-3 w-3', config.color)} />
            <span className="text-xs font-medium">{config.label}</span>
          </div>
        );

      case 'detailed':
        return (
          <div className={cn(
            'flex items-center gap-3 p-3 rounded-lg border',
            config.bgColor,
            config.borderColor
          )}>
            <Icon className={cn('h-5 w-5', config.color)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium">{config.label}</span>
                {status === 'ONLINE' && responseTime && (
                  <Badge variant="secondary" className="text-xs">
                    {formatResponseTime(responseTime)}
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                Last checked: {formatLastChecked(lastChecked)}
              </div>
              {status === 'OFFLINE' && errorMessage && (
                <div className="text-sm text-red-600 mt-1 truncate">
                  {errorMessage}
                </div>
              )}
            </div>
          </div>
        );

      default:
        return (
          <Badge 
            variant="secondary" 
            className={cn(
              'flex items-center gap-1',
              config.bgColor,
              config.color,
              'border',
              config.borderColor
            )}
          >
            <Icon className="h-3 w-3" />
            <span>{config.label}</span>
            {status === 'ONLINE' && responseTime && (
              <span className="text-xs opacity-75">
                ({formatResponseTime(responseTime)})
              </span>
            )}
          </Badge>
        );
    }
  };

  const content = (
    <div className={cn(className)}>
      {renderContent()}
    </div>
  );

  if (!showTooltip || variant === 'detailed') {
    return content;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {tooltipContent}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Animated loading indicator for when status is being checked
export function HostStatusLoading({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
      <span className="text-xs text-muted-foreground">Checking...</span>
    </div>
  );
}

// Connectivity signal strength indicator
export function ConnectivitySignal({ 
  responseTime, 
  className 
}: { 
  responseTime?: number; 
  className?: string; 
}) {
  if (!responseTime) {
    return <WifiOff className={cn('h-4 w-4 text-gray-400', className)} />;
  }

  // Determine signal strength based on response time
  let strength: 'excellent' | 'good' | 'fair' | 'poor';
  let color: string;

  if (responseTime < 100) {
    strength = 'excellent';
    color = 'text-green-600';
  } else if (responseTime < 300) {
    strength = 'good';
    color = 'text-green-500';
  } else if (responseTime < 1000) {
    strength = 'fair';
    color = 'text-yellow-500';
  } else {
    strength = 'poor';
    color = 'text-red-500';
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Wifi className={cn('h-4 w-4', color, className)} />
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <div>Signal: {strength}</div>
            <div>Response: {formatResponseTime(responseTime)}</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Quick status overview for multiple hosts
export function HostStatusSummary({ 
  total, 
  online, 
  offline, 
  unknown,
  className 
}: { 
  total: number;
  online: number;
  offline: number;
  unknown: number;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-4 text-sm', className)}>
      <div className="flex items-center gap-1">
        <CheckCircle className="h-4 w-4 text-green-600" />
        <span className="font-medium">{online}</span>
        <span className="text-muted-foreground">online</span>
      </div>
      
      <div className="flex items-center gap-1">
        <XCircle className="h-4 w-4 text-red-600" />
        <span className="font-medium">{offline}</span>
        <span className="text-muted-foreground">offline</span>
      </div>
      
      {unknown > 0 && (
        <div className="flex items-center gap-1">
          <AlertCircle className="h-4 w-4 text-gray-600" />
          <span className="font-medium">{unknown}</span>
          <span className="text-muted-foreground">unknown</span>
        </div>
      )}
      
      <div className="text-muted-foreground">
        of {total} hosts
      </div>
    </div>
  );
}
