export interface AppSettings {
  sshConcurrency: number; // 并发 10–100，默认 30
  commandTimeoutSeconds: number; // 超时 10–900s，默认 100s
  containerUpdateCheckCron: string; // 默认每日 00:45 → "45 0 * * *"
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  sshConcurrency: 30,
  commandTimeoutSeconds: 100,
  containerUpdateCheckCron: '45 0 * * *'
};

export interface Host {
  id: string;
  name: string;
  address: string; // IP/DNS
  sshUser: string;
  port?: number;
  tags?: string[];
}

export interface TaskRunSummary {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  startedAt?: string;
  finishedAt?: string;
}

