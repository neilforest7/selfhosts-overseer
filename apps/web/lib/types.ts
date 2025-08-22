export type OperationLog = {
  id: string;
  title: string;
  status: 'RUNNING' | 'COMPLETED' | 'ERROR';
  executionType: 'MANUAL' | 'AUTOMATIC';
  startTime: string;
  endTime: string | null;
  logs: string;
  createdAt: string;
  updatedAt: string;
};
