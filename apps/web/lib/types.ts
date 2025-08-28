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