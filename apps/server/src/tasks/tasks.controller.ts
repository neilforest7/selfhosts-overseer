import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { OperationLog } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';

class ExecDto {
  opId = '';
  command = '';
  targets: string[] = [];
}

@Controller('/api/v1/tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post('exec')
  async exec(@Body() body: ExecDto): Promise<OperationLog | null> {
    return this.tasksService.exec(body);
  }
}

