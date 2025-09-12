'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { 
  CheckCircle, 
  XCircle, 
  Clock, 
  Pause, 
  RotateCcw,
  Play,
  AlertTriangle,
  Trash2,
  Power,
  Circle,
  SeparatorVertical
} from 'lucide-react';
import { Separator } from './ui/separator';

export type ContainerState = 
  | 'running' 
  | 'starting' 
  | 'exited' 
  | 'stopped' 
  | 'error' 
  | 'failed'
  | 'paused'
  | 'restarting'
  | 'created'
  | 'removed'
  | 'compose-down'
  | 'unknown';

export interface ContainerStatusIndicatorProps {
  state?: string;
  status?: string;
  isComposeManaged?: boolean;
  containerName?: string;
  hostName?: string;
  lastUpdated?: string | Date;
  errorMessage?: string;
  variant?: 'default' | 'compact' | 'detailed' | 'icon-only';
  showTooltip?: boolean;
  className?: string;
}

const statusConfig = {
  running: {
    icon: CheckCircle,
    color: 'text-green-600',
    bgColor: 'bg-green-100 dark:bg-green-900',
    borderColor: 'border-green-200 dark:border-green-800',
    label: '运行中',
    description: '容器正在正常运行',
  },
  starting: {
    icon: Play,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100 dark:bg-blue-900',
    borderColor: 'border-blue-200 dark:border-blue-800',
    label: '启动中',
    description: '容器正在启动过程中',
  },
  exited: {
    icon: Power,
    color: 'text-gray-600',
    bgColor: 'bg-gray-100 dark:bg-gray-900',
    borderColor: 'border-gray-200 dark:border-gray-800',
    label: '已退出',
    description: 'CLI容器已退出',
  },
  stopped: {
    icon: Power,
    color: 'text-gray-600',
    bgColor: 'bg-gray-100 dark:bg-gray-900',
    borderColor: 'border-gray-200 dark:border-gray-800',
    label: '已停止',
    description: 'Compose服务已停止',
  },
  error: {
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900',
    borderColor: 'border-red-200 dark:border-red-800',
    label: '错误',
    description: '容器运行出现错误',
  },
  failed: {
    icon: XCircle,
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900',
    borderColor: 'border-red-200 dark:border-red-800',
    label: '失败',
    description: '容器启动或运行失败',
  },
  paused: {
    icon: Pause,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100 dark:bg-yellow-900',
    borderColor: 'border-yellow-200 dark:border-yellow-800',
    label: '已暂停',
    description: '容器已暂停执行',
  },
  restarting: {
    icon: RotateCcw,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100 dark:bg-orange-900',
    borderColor: 'border-orange-200 dark:border-orange-800',
    label: '重启中',
    description: '容器正在重启',
  },
  created: {
    icon: Circle,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50 dark:bg-gray-800',
    borderColor: 'border-gray-200 dark:border-gray-700',
    label: '已创建',
    description: '容器已创建但未启动',
  },
  removed: {
    icon: Trash2,
    color: 'text-red-600',
    bgColor: 'bg-red-100 dark:bg-red-900',
    borderColor: 'border-red-200 dark:border-red-800',
    label: '已移除',
    description: '容器已从Docker中移除但数据库记录仍存在',
  },
  'compose-down': {
    icon: Power,
    color: 'text-gray-600',
    bgColor: 'bg-gray-100 dark:bg-gray-900',
    borderColor: 'border-gray-200 dark:border-gray-800',
    label: '已下线',
    description: '通过docker compose down停止的容器',
  },
  unknown: {
    icon: AlertTriangle,
    color: 'text-gray-500',
    bgColor: 'bg-gray-50 dark:bg-gray-800',
    borderColor: 'border-gray-200 dark:border-gray-700',
    label: '未知',
    description: '容器状态未知或无法识别',
  },
};

function normalizeContainerState(state?: string, status?: string, isComposeManaged?: boolean): ContainerState {
  const normalizedState = state?.toLowerCase() || '';
  const normalizedStatus = status?.toLowerCase() || '';

  // 优先处理新增的容器生命周期状态
  if (normalizedState === 'removed') return 'removed';
  if (normalizedState === 'compose-down') return 'compose-down';

  // 处理标准Docker容器状态
  if (normalizedState.includes('running') || normalizedStatus.includes('up')) return 'running';
  if (normalizedState.includes('starting') || normalizedStatus.includes('starting')) return 'starting';
  
  if (normalizedState.includes('exited') || normalizedState.includes('stopped') || normalizedStatus.includes('exited')) {
    return isComposeManaged ? 'stopped' : 'exited';
  }
  
  if (normalizedState.includes('error') || normalizedState.includes('failed') || normalizedStatus.includes('error')) {
    return normalizedState.includes('failed') ? 'failed' : 'error';
  }
  
  if (normalizedState.includes('paused')) return 'paused';
  if (normalizedState.includes('restarting')) return 'restarting';
  if (normalizedState.includes('created')) return 'created';

  return 'unknown';
}

function formatLastUpdated(date?: string | Date): string {
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

export function ContainerStatusIndicator({
  state,
  status,
  isComposeManaged,
  containerName,
  hostName,
  lastUpdated,
  errorMessage,
  variant = 'default',
  showTooltip = true,
  className,
}: ContainerStatusIndicatorProps) {
  const normalizedState = normalizeContainerState(state, status, isComposeManaged);
  const config = statusConfig[normalizedState];
  const Icon = config.icon;

  const tooltipContent = (
    <div className="space-y-2 text-sm">
      <div>{config.label}</div>
      <div className="text-xs">{config.description}</div>
      <Separator />
      
      {containerName && (
        <div>
          <span className="font-medium">Container:</span> {containerName}
        </div>
      )}
      {hostName && (
        <div>
          <span className="font-medium">Host:</span> {hostName}
        </div>
      )}
      
      {normalizedState === 'error' && errorMessage && (
        <div className="text-red-400">
          <span className="font-medium">Error:</span> {errorMessage}
        </div>
      )}
      <Separator/>
      <div>
        <span className="font-medium">State:</span> {state || 'N/A'}
      </div>
      {status && (
        <div>
          <span className="font-medium">Status:</span> {status}
        </div>
      )}
      <div>
        <span className="font-medium">Type:</span> {isComposeManaged ? 'Compose' : 'CLI'}
      </div>
      <div>
        <span className="font-medium">Last updated:</span> {formatDateTime(lastUpdated)}
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
          <Badge className="inline-flex items-center gap-2" variant={'outline'}>
            <Icon className={cn('h-3 w-3', config.color)} />
            <span className="leading-none py-1">{config.label}</span>
          </Badge>
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
                {isComposeManaged && (
                  <Badge variant="outline" className="text-xs">
                    Compose
                  </Badge>
                )}
              </div>
              <div className="text-sm text-muted-foreground">
                {containerName && `Container: ${containerName}`}
                {hostName && ` • Host: ${hostName}`}
              </div>
              <div className="text-xs text-muted-foreground">
                Last updated: {formatLastUpdated(lastUpdated)}
              </div>
              {normalizedState === 'error' && errorMessage && (
                <div className="text-sm text-red-600 mt-1 truncate">
                  Error: {errorMessage}
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
            {isComposeManaged && (
              <span className="text-xs opacity-75">(Compose)</span>
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

// Animated loading indicator for when container status is being checked
export function ContainerStatusLoading({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Clock className="h-3 w-3 animate-spin text-blue-600" />
      <span className="text-xs text-muted-foreground">检查中...</span>
    </div>
  );
}

// Status summary for multiple containers (like in group views)
export function ContainerStatusSummary({ 
  total, 
  running, 
  stopped, 
  error,
  other,
  className 
}: { 
  total: number;
  running: number;
  stopped: number;
  error: number;
  other: number;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-4 text-sm', className)}>
      <Badge className="flex items-center gap-1" variant={"outline"}>
        <CheckCircle className="h-4 w-4 text-green-600" />
        <span className="font-medium">{running}</span>
        <span className="text-muted-foreground">运行</span>
      </Badge>
      
      <Badge className="flex items-center gap-1" variant={"outline"}>
        <Power className="h-4 w-4 text-gray-600" />
        <span className="font-medium">{stopped}</span>
        <span className="text-muted-foreground">已停止</span>
      </Badge>
      
      {error > 0 && (
        <Badge className="flex items-center gap-1" variant={"outline"}>
          <XCircle className="h-4 w-4 text-red-600" />
          <span className="font-medium">{error}</span>
          <span className="text-muted-foreground">错误</span>
        </Badge>
      )}
      
      {other > 0 && (
        <Badge className="flex items-center gap-1" variant={"outline"}>
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          <span className="font-medium">{other}</span>
          <span className="text-muted-foreground">其他</span>
        </Badge>
      )}
      
      <Badge className="text-muted-foreground">
        共 {total} 个容器
      </Badge>
    </div>
  );
}

// Partial status indicator for groups (like compose projects)
export function ContainerPartialStatusIndicator({ 
  total, 
  running, 
  className 
}: { 
  total: number;
  running: number;
  className?: string;
}) {
  const percentage = total > 0 ? Math.round((running / total) * 100) : 0;
  
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('flex items-center gap-2', className)}>
            <Badge variant="secondary" className="bg-background text-amber-600 border-amber-600 gap-1">
              <AlertTriangle className="h-3 w-3" />
              <div className='leading-none py-1'>部分运行</div>
            </Badge>
            {/* <span className="text-xs text-muted-foreground">
              {running}/{total} ({percentage}%)
            </span> */}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <div>部分容器正在运行，部分已停止</div>
            <Separator className="my-2"/>
            <div>运行中: {running} / 总计: {total}</div>
            <div>完成率: {percentage}%</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}