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
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import { TestAutomationRuleDto } from './dto/test-automation-rule.dto';

@Controller('/api/v1/automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() data: CreateAutomationRuleDto) {
    console.log('Controller received automation rule data:', JSON.stringify(data, null, 2));

    // Convert DTO to service format (normalized schema only)
    const serviceData = {
      name: data.name,
      description: data.description,
      isEnabled: data.isEnabled,
      priority: data.priority,
      category: data.category,
      tags: data.tags,
      templateId: data.templateId,
      parentRuleId: data.parentRuleId,
      triggers: (data.triggers || []).map(trigger => {
        console.log(`Processing trigger: ${trigger.type}`);
        console.log(`Raw trigger config: ${trigger.config}`);
        console.log(`Raw trigger conditions: ${trigger.conditions}`);

        const parsedConfig = trigger.config ? JSON.parse(trigger.config) : {};
        const parsedConditions = trigger.conditions ? JSON.parse(trigger.conditions) : {};

        console.log(`Parsed trigger config:`, parsedConfig);
        console.log(`Parsed trigger conditions:`, parsedConditions);

        return {
          type: trigger.type,
          name: trigger.name,
          description: trigger.description,
          isEnabled: trigger.isEnabled,
          priority: trigger.priority,
          pluginId: trigger.pluginId,
          pluginVersion: trigger.pluginVersion,
          config: parsedConfig,
          conditions: parsedConditions
        };
      }),
      events: (data.events || []).map(event => ({
        type: event.type,
        name: event.name,
        description: event.description,
        isEnabled: event.isEnabled,
        priority: event.priority,
        pluginId: event.pluginId,
        pluginVersion: event.pluginVersion,
        params: event.params ? JSON.parse(event.params) : {},
        options: event.options ? JSON.parse(event.options) : {}
      })),
      notifications: data.notifications?.map(notification => ({
        name: notification.name,
        description: notification.description,
        isEnabled: notification.isEnabled,
        notifyOn: notification.notifyOn as ('SUCCESS' | 'FAILURE' | 'ALWAYS' | 'WARNING')[],
        templateId: notification.templateId,
        channels: (notification.channels || []).map(channel => ({
          type: channel.type,
          config: channel.config ? JSON.parse(channel.config) : {},
          isEnabled: channel.isEnabled
        }))
      }))
    };
    return this.automationsService.create(serviceData);
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
  update(@Param('id') id: string, @Body() data: UpdateAutomationRuleDto) {
    return this.automationsService.update(id, data);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.automationsService.remove(id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id') id: string, @Body() data: TestAutomationRuleDto) {
    return this.automationsService.testRule(id, data);
  }
}
