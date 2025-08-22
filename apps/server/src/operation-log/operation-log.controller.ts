import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { OperationLogService } from './operation-log.service';
import { ExecType } from '@prisma/client';

class CreateOperationLogDto {
  title: string;
  executionType?: ExecType;
}

@Controller('api/v1/operations')
export class OperationLogController {
  constructor(private readonly operationLogService: OperationLogService) {}

  @Post()
  create(@Body() createOperationLogDto: CreateOperationLogDto) {
    return this.operationLogService.create(createOperationLogDto.title, createOperationLogDto.executionType);
  }

  @Get()
  findAll() {
    return this.operationLogService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.operationLogService.findOne(id);
  }
}
