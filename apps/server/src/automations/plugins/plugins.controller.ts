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
  Injectable,
} from '@nestjs/common';
import { PluginRegistry } from './registry/plugin-registry.service';
import { PluginRegistration } from './interfaces';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('/api/v1/plugins')
export class PluginsController {
  constructor(
    private readonly pluginRegistry: PluginRegistry,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Get database plugin ID by plugin name
   */
  private async getDbPluginId(pluginName: string): Promise<string | null> {
    try {
      // Map plugin IDs to database names
      const pluginNameMap: Record<string, string> = {
        'cron-trigger': 'cron',
        'manual-trigger': 'manual',
        'webhook-trigger': 'webhook',
        'http-health-check-trigger': 'http-health-check',
        'filesystem-trigger': 'filesystem',
        'container-state-trigger': 'container-state',
        'system-resource-trigger': 'system-resource',
        'log-message-event': 'log-message',
        'restart-container-event': 'restart-container',
        'discover-containers-event': 'discover-containers',
        'check-container-updates-event': 'check-container-updates',
        'send-notification-event': 'send-notification',
        'execute-command-event': 'execute-command',
        'file-operations-event': 'file-operations',
        'container-management-event': 'container-management'
      };

      const dbName = pluginNameMap[pluginName] || pluginName;
      
      const pluginMetadata = await this.prisma.pluginMetadata.findUnique({
        where: { name: dbName }
      });
      return pluginMetadata?.id || null;
    } catch (error) {
      // Log error but don't fail the request
      console.error(`Failed to get database plugin ID for ${pluginName}:`, error);
      return null;
    }
  }

  @Get()
  getAllPlugins() {
    const plugins = this.pluginRegistry.getAllPlugins();
    return Array.from(plugins.entries()).map(([id, plugin]) => ({
      id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      enabled: plugin.enabled,
      author: plugin.author,
      tags: plugin.tags,
      dependencies: plugin.dependencies,
      type: this.getPluginType(plugin)
    }));
  }

  @Get('summary')
  getPluginSummary() {
    return this.pluginRegistry.getPluginSummary();
  }

  @Get('triggers')
  async getTriggerPlugins() {
    const triggerPlugins = this.pluginRegistry.getTriggerPlugins();
    const result = [];

    for (const [type, plugin] of triggerPlugins.entries()) {
      const dynamicOptions = plugin.getTriggerDynamicOptions ?
        await plugin.getTriggerDynamicOptions() : {};
      
      const dbPluginId = await this.getDbPluginId(plugin.id);

      result.push({
        type: 'trigger',
        triggerType: type,
        id: plugin.id,
        dbPluginId,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        enabled: plugin.enabled,
        configSchema: plugin.getTriggerConfigSchema?.() || plugin.configSchema,
        availableConditions: plugin.getAvailableConditions?.(),
        dynamicOptions
      });
    }

    return result;
  }

  @Get('events')
  async getEventPlugins() {
    const eventPlugins = this.pluginRegistry.getEventPlugins();
    const result = [];

    for (const [type, plugin] of eventPlugins.entries()) {
      const dynamicOptions = plugin.getEventDynamicOptions ?
        await plugin.getEventDynamicOptions() : {};
      
      const dbPluginId = await this.getDbPluginId(plugin.id);

      result.push({
        type: 'event',
        eventType: type,
        id: plugin.id,
        dbPluginId,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        enabled: plugin.enabled,
        configSchema: plugin.getEventConfigSchema?.() || plugin.configSchema,
        paramsSchema: plugin.getEventParamsSchema?.(),
        availableActions: (plugin as any).getAvailableActions?.(),
        dynamicOptions
      });
    }

    return result;
  }

  @Get(':id')
  async getPlugin(@Param('id') id: string) {
    const plugin = this.pluginRegistry.getPlugin(id);
    if (!plugin) {
      return { error: `Plugin with ID '${id}' not found` };
    }

    // Get configuration schema from plugin methods
    let configSchema = plugin.configSchema;
    if (!configSchema) {
      if ('getTriggerConfigSchema' in plugin && typeof plugin.getTriggerConfigSchema === 'function') {
        configSchema = plugin.getTriggerConfigSchema();
      } else if ('getEventConfigSchema' in plugin && typeof plugin.getEventConfigSchema === 'function') {
        configSchema = plugin.getEventConfigSchema();
      }
    }

    // Get dynamic options
    let dynamicOptions = {};
    if ('getTriggerDynamicOptions' in plugin && typeof plugin.getTriggerDynamicOptions === 'function') {
      dynamicOptions = await plugin.getTriggerDynamicOptions();
    } else if ('getEventDynamicOptions' in plugin && typeof plugin.getEventDynamicOptions === 'function') {
      dynamicOptions = await plugin.getEventDynamicOptions();
    } else if ('getDynamicConfigOptions' in plugin && typeof plugin.getDynamicConfigOptions === 'function') {
      dynamicOptions = await plugin.getDynamicConfigOptions();
    }

    const dbPluginId = await this.getDbPluginId(plugin.id);

    return {
      id: plugin.id,
      dbPluginId,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      enabled: plugin.enabled,
      author: plugin.author,
      tags: plugin.tags,
      dependencies: plugin.dependencies,
      configSchema,
      dynamicOptions,
      type: this.getPluginType(plugin)
    };
  }

  @Get(':id/dynamic-options')
  async getPluginDynamicOptions(@Param('id') id: string) {
    const plugin = this.pluginRegistry.getPlugin(id);
    if (!plugin) {
      return { error: `Plugin with ID '${id}' not found` };
    }

    try {
      let dynamicOptions = {};

      if ('getTriggerDynamicOptions' in plugin && typeof plugin.getTriggerDynamicOptions === 'function') {
        dynamicOptions = await plugin.getTriggerDynamicOptions();
      } else if ('getEventDynamicOptions' in plugin && typeof plugin.getEventDynamicOptions === 'function') {
        dynamicOptions = await plugin.getEventDynamicOptions();
      } else if ('getDynamicConfigOptions' in plugin && typeof plugin.getDynamicConfigOptions === 'function') {
        dynamicOptions = await plugin.getDynamicConfigOptions();
      }

      return { dynamicOptions };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { error: `Failed to get dynamic options: ${errorMessage}` };
    }
  }

  @Post(':id/reload')
  @HttpCode(HttpStatus.OK)
  async reloadPlugin(@Param('id') id: string) {
    try {
      await this.pluginRegistry.reloadPlugin(id);
      return { success: true, message: `Plugin '${id}' reloaded successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  @Patch(':id/enabled')
  async setPluginEnabled(@Param('id') id: string, @Body() data: { enabled: boolean }) {
    try {
      await this.pluginRegistry.setPluginEnabled(id, data.enabled);
      return { success: true, message: `Plugin '${id}' ${data.enabled ? 'enabled' : 'disabled'}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async registerPlugin(@Body() registration: PluginRegistration) {
    try {
      await this.pluginRegistry.registerPlugin(registration);
      return { success: true, message: `Plugin '${registration.metadata.id}' registered successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregisterPlugin(@Param('id') id: string) {
    try {
      await this.pluginRegistry.unregisterPlugin(id);
      return { success: true, message: `Plugin '${id}' unregistered successfully` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }

  private getPluginType(plugin: any): string {
    const types: string[] = [];
    
    if ('triggerType' in plugin && 'evaluate' in plugin) {
      types.push('trigger');
    }
    
    if ('eventType' in plugin && 'execute' in plugin) {
      types.push('event');
    }
    
    return types.length > 0 ? types.join(', ') : 'unknown';
  }
}