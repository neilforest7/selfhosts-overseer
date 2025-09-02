export type OperationLogEntry = {
  id: string;
  timestamp: string;
  stream: string;
  content: string;
  hostId: string | null;
};

export type OperationLog = {
  id: string;
  title: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'ERROR' | 'CANCELLED';
  triggerType: 'MANUAL' | 'CRON' | 'WEBHOOK' | 'EVENT' | 'SYSTEM';
  startTime: string;
  endTime: string | null;
  entries: OperationLogEntry[];
};

export type ActivityCategory =
  | 'HOST_MANAGEMENT'
  | 'CONTAINER_LIFECYCLE'
  | 'CONTAINER_UPDATE'
  | 'COMPOSE_OPERATION'
  | 'FRP_CONFIGURATION'
  | 'REVERSE_PROXY'
  | 'SYSTEM_OPERATION'
  | 'AUTOMATION';

export type ActivityLog = {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  hostId?: string;
  hostName?: string;
  title: string;
  description?: string;
  metadata?: any;
  oldValues?: any;
  newValues?: any;
  host?: {
    name: string;
    address: string;
  };
};

export type ActivityLogQueryParams = {
  category?: ActivityCategory;
  resourceType?: string;
  hostId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  search?: string;
};

export type ActivityLogResponse = {
  items: ActivityLog[];
  total: number;
  hasMore: boolean;
};