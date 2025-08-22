import { Body, Controller, Post } from '@nestjs/common';
import { ExecRequest, TasksService, TaskSubmissionReceipt } from './tasks.service';

@Controller('/api/v1/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('exec')
  async exec(@Body() body: ExecRequest): Promise<TaskSubmissionReceipt> {
    return this.tasksService.exec(body);
  }
}

