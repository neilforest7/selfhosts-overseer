import { Controller, Get, Query } from '@nestjs/common';
import { LogsService, LogEntry } from './logs.service';

@Controller('api/v1/logs')
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get('application')
  async getApplicationLogs(@Query('limit') limit?: string): Promise<{ logs: LogEntry[] }> {
    const limitNum = limit ? parseInt(limit, 10) : 100;
    const logs = this.logsService.getRecentLogs(limitNum);
    return { logs };
  }

  @Get('system')
  async getSystemLogs(@Query('lines') lines?: string): Promise<{ logs: string[] }> {
    const linesNum = lines ? parseInt(lines, 10) : 100;
    const logs = await this.logsService.getSystemLogs(linesNum);
    return { logs };
  }

  @Get('docker')
  async getDockerLogs(
    @Query('container') container?: string,
    @Query('lines') lines?: string
  ): Promise<{ logs: string[] }> {
    const linesNum = lines ? parseInt(lines, 10) : 100;
    const logs = await this.logsService.getDockerLogs(container, linesNum);
    return { logs };
  }
}
