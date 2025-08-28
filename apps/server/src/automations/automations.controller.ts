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
import { AutomationsService } from './automations.service';
import { Prisma } from '@prisma/client';

@Controller('/api/v1/automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() data: Prisma.AutomationRuleCreateInput) {
    return this.automationsService.create(data);
  }

  @Get()
  findAll() {
    return this.automationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.automationsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() data: Prisma.AutomationRuleUpdateInput) {
    return this.automationsService.update(id, data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.automationsService.remove(id);
  }
}
