import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { OperationLogService } from './operation-log.service';
import { TriggerType } from '@prisma/client';
import { Prisma } from '@prisma/client';

class CreateOperationLogDto {
  title: string;
  triggerType?: TriggerType;
  triggerContext?: Prisma.JsonValue;
  context?: Prisma.JsonValue;
}

@Controller('api/v1/operations')
export class OperationLogController {
  constructor(private readonly operationLogService: OperationLogService) {}

  @Post()
  create(@Body() createOperationLogDto: CreateOperationLogDto) {
    return this.operationLogService.create(createOperationLogDto);
  }

  @Get()
  findAll() {
    return this.operationLogService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.operationLogService.findOneWithEntries(id);
  }
}
