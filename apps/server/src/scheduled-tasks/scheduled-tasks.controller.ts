import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ScheduledTasksService } from './scheduled-tasks.service';
import { Prisma } from '@prisma/client';

// It's a good practice to use DTOs (Data Transfer Objects)
// for request bodies to add validation and clear contracts.
class CreateScheduledTaskDto {
  name: string;
  description?: string;
  taskType: string;
  cron: string;
  command?: string;
  targetHostIds?: string[];
  isEnabled?: boolean;
}

class UpdateScheduledTaskDto {
  name?: string;
  description?: string;
  taskType?: string;
  cron?: string;
  command?: string;
  targetHostIds?: string[];
  isEnabled?: boolean;
}

@Controller('/api/v1/scheduled-tasks')
export class ScheduledTasksController {
  constructor(private readonly scheduledTasksService: ScheduledTasksService) {}

  @Post()
  create(@Body() data: CreateScheduledTaskDto) {
    return this.scheduledTasksService.create(data);
  }

  @Get()
  findAll() {
    return this.scheduledTasksService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.scheduledTasksService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: UpdateScheduledTaskDto,
  ) {
    return this.scheduledTasksService.update(id, data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.scheduledTasksService.remove(id);
  }

  @Post(':id/run')
  runOnce(@Param('id') id: string) {
    return this.scheduledTasksService.runManually(id);
  }
}