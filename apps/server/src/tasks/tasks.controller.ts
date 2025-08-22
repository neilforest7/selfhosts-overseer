import { Body, Controller, Post } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { OperationLog } from '@prisma/client';

class ExecDto {
  opId: string;
  command: string;
  targets: string[];
}

@Controller('/api/v1/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('exec')
  async exec(@Body() body: ExecDto): Promise<OperationLog> {
    return this.tasksService.exec(body);
  }
}

