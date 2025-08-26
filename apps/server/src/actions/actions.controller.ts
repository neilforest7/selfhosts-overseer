import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { Prisma } from '@prisma/client';

class CreateActionDto {
  name: string;
  description?: string;
  taskType: string;
  taskPayload?: Prisma.JsonValue;
}

class UpdateActionDto {
  name?: string;
  description?: string;
  taskType?: string;
  taskPayload?: Prisma.JsonValue;
}

@Controller('/api/v1/actions')
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  @Post()
  create(@Body() data: CreateActionDto) {
    return this.actionsService.create(data);
  }

  @Get()
  findAll() {
    return this.actionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.actionsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: UpdateActionDto) {
    return this.actionsService.update(id, data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.actionsService.remove(id);
  }

  @Post(':id/run')
  runOnce(@Param('id') id: string) {
    return this.actionsService.runManually(id);
  }
}
