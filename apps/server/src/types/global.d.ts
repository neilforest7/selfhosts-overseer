import { LogsService } from '../logs/logs.service';

declare global {
  var logsServiceInstance: LogsService | undefined;
}

export {};
