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
import { PluginRegistry } from './registry/plugin-registry.service';
import { PluginRegistration } from './interfaces';
import { PluginMetadataService } from '../plugin-metadata.service';

@Controller('/api/v1/plugins')
export class PluginsController {
  constructor(
    private readonly pluginRegistry: PluginRegistry,
    private readonly pluginMetadataService: PluginMetadataService
  ) {}

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
      // Find the corresponding database plugin metadata by name (type)
      const dbPlugin = await this.pluginMetadataService.findByName(type);

      result.push({
        type: 'trigger',
        triggerType: type,
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        enabled: plugin.enabled,
        configSchema: plugin.getTriggerConfigSchema?.() || plugin.configSchema,
        availableConditions: plugin.getAvailableConditions?.(),
        // Add database plugin metadata ID for foreign key references
        dbPluginId: dbPlugin ? (dbPlugin as any).id : null
      });
    }

    return result;
  }

  @Get('events')
  async getEventPlugins() {
    const eventPlugins = this.pluginRegistry.getEventPlugins();
    const result = [];

    for (const [type, plugin] of eventPlugins.entries()) {
      // Find the corresponding database plugin metadata by name (type)
      const dbPlugin = await this.pluginMetadataService.findByName(type);

      result.push({
        type: 'event',
        eventType: type,
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        version: plugin.version,
        enabled: plugin.enabled,
        configSchema: plugin.getEventConfigSchema?.() || plugin.configSchema,
        paramsSchema: plugin.getEventParamsSchema?.(),
        availableActions: (plugin as any).getAvailableActions?.(),
        // Add database plugin metadata ID for foreign key references
        dbPluginId: dbPlugin ? (dbPlugin as any).id : null
      });
    }

    return result;
  }

  @Get(':id')
  getPlugin(@Param('id') id: string) {
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

    return {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      enabled: plugin.enabled,
      author: plugin.author,
      tags: plugin.tags,
      dependencies: plugin.dependencies,
      configSchema,
      type: this.getPluginType(plugin)
    };
  }

  @Post(':id/reload')
  @HttpCode(HttpStatus.OK)
  async reloadPlugin(@Param('id') id: string) {
    try {
      await this.pluginRegistry.reloadPlugin(id);
      return { success: true, message: `Plugin '${id}' reloaded successfully` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Patch(':id/enabled')
  async setPluginEnabled(@Param('id') id: string, @Body() data: { enabled: boolean }) {
    try {
      await this.pluginRegistry.setPluginEnabled(id, data.enabled);
      return { success: true, message: `Plugin '${id}' ${data.enabled ? 'enabled' : 'disabled'}` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async registerPlugin(@Body() registration: PluginRegistration) {
    try {
      await this.pluginRegistry.registerPlugin(registration);
      return { success: true, message: `Plugin '${registration.metadata.id}' registered successfully` };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregisterPlugin(@Param('id') id: string) {
    try {
      await this.pluginRegistry.unregisterPlugin(id);
      return { success: true, message: `Plugin '${id}' unregistered successfully` };
    } catch (error) {
      return { success: false, error: error.message };
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