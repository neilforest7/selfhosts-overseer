import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { 
  IPlugin, 
  ITriggerPlugin, 
  IEventPlugin, 
  PluginRegistration,
  TriggerPluginRegistration,
  EventPluginRegistration 
} from '../interfaces';

export interface PluginRegistryConfig {
  /** Auto-discover plugins from filesystem */
  autoDiscovery?: boolean;
  
  /** Directories to scan for plugins */
  pluginDirectories?: string[];
  
  /** Enable plugin hot-reloading */
  hotReload?: boolean;
  
  /** Plugin loading timeout */
  loadTimeout?: number;
}

/**
 * Central registry for all automation plugins
 * Manages plugin loading, registration, and lifecycle
 */
@Injectable()
export class PluginRegistry implements OnModuleInit {
  private readonly logger = new Logger(PluginRegistry.name);
  
  /** All registered plugins */
  private readonly plugins = new Map<string, IPlugin>();
  
  /** Trigger plugins indexed by trigger type */
  private readonly triggerPlugins = new Map<string, ITriggerPlugin>();
  
  /** Event plugins indexed by event type */
  private readonly eventPlugins = new Map<string, IEventPlugin>();
  
  /** Plugin dependencies graph */
  private readonly dependencyGraph = new Map<string, string[]>();
  
  /** Plugin load order */
  private readonly loadOrder: string[] = [];
  
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: PluginRegistryConfig = {}
  ) {}
  
  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing Plugin Registry...');
    
    try {
      // Register built-in plugins automatically
      await this.registerBuiltinPlugins();
      
      // Auto-discover plugins if enabled
      if (this.config.autoDiscovery) {
        await this.discoverPlugins();
      }
      
      this.logger.log(`Plugin Registry initialized with ${this.plugins.size} plugins`);
      this.logPluginSummary();
    } catch (error) {
      this.logger.error('Failed to initialize Plugin Registry', error);
      throw error;
    }
  }
  
  /**
   * Register a plugin manually
   */
  async registerPlugin(registration: PluginRegistration): Promise<void> {
    const { metadata, pluginClass, config = {} } = registration;
    
    this.logger.debug(`Registering plugin: ${metadata.id}`);
    
    // Check for duplicate IDs
    if (this.plugins.has(metadata.id)) {
      throw new Error(`Plugin with ID '${metadata.id}' is already registered`);
    }
    
    // Validate dependencies
    if (metadata.dependencies) {
      for (const depId of metadata.dependencies) {
        if (!this.plugins.has(depId)) {
          throw new Error(`Plugin '${metadata.id}' depends on '${depId}' which is not registered`);
        }
      }
    }
    
    try {
      // Create plugin instance
      const pluginInstance = new pluginClass();
      
      // Validate plugin configuration
      if (pluginInstance.validateConfig) {
        const isValid = await pluginInstance.validateConfig(config);
        if (!isValid) {
          throw new Error(`Invalid configuration for plugin '${metadata.id}'`);
        }
      }
      
      // Initialize plugin
      await pluginInstance.initialize();
      
      // Register plugin
      this.plugins.set(metadata.id, pluginInstance);
      
      // Register type-specific plugins
      if (this.isTriggerPlugin(pluginInstance)) {
        await this.registerTriggerPlugin(pluginInstance);
      }
      
      if (this.isEventPlugin(pluginInstance)) {
        await this.registerEventPlugin(pluginInstance);
      }
      
      // Track dependencies
      if (metadata.dependencies) {
        this.dependencyGraph.set(metadata.id, metadata.dependencies);
      }
      
      this.logger.log(`Successfully registered plugin: ${metadata.name} (${metadata.id})`);
      
    } catch (error) {
      this.logger.error(`Failed to register plugin '${metadata.id}': ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Unregister a plugin
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' is not registered`);
    }
    
    this.logger.debug(`Unregistering plugin: ${pluginId}`);
    
    try {
      // Check for dependent plugins
      const dependents = this.getPluginDependents(pluginId);
      if (dependents.length > 0) {
        throw new Error(`Cannot unregister plugin '${pluginId}': depended on by ${dependents.join(', ')}`);
      }
      
      // Cleanup plugin
      await plugin.cleanup();
      
      // Remove from registries
      this.plugins.delete(pluginId);
      
      if (this.isTriggerPlugin(plugin)) {
        this.triggerPlugins.delete(plugin.triggerType);
      }
      
      if (this.isEventPlugin(plugin)) {
        this.eventPlugins.delete(plugin.eventType);
      }
      
      // Remove dependencies
      this.dependencyGraph.delete(pluginId);
      
      this.logger.log(`Successfully unregistered plugin: ${pluginId}`);
      
    } catch (error) {
      this.logger.error(`Failed to unregister plugin '${pluginId}': ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get all registered plugins
   */
  getAllPlugins(): Map<string, IPlugin> {
    return new Map(this.plugins);
  }
  
  /**
   * Get plugin by ID
   */
  getPlugin(pluginId: string): IPlugin | undefined {
    return this.plugins.get(pluginId);
  }
  
  /**
   * Get all trigger plugins
   */
  getTriggerPlugins(): Map<string, ITriggerPlugin> {
    return new Map(this.triggerPlugins);
  }
  
  /**
   * Get trigger plugin by type
   */
  getTriggerPlugin(triggerType: string): ITriggerPlugin | undefined {
    return this.triggerPlugins.get(triggerType);
  }
  
  /**
   * Get all event plugins
   */
  getEventPlugins(): Map<string, IEventPlugin> {
    return new Map(this.eventPlugins);
  }
  
  /**
   * Get event plugin by type
   */
  getEventPlugin(eventType: string): IEventPlugin | undefined {
    return this.eventPlugins.get(eventType);
  }
  
  /**
   * Get plugin metadata summary
   */
  getPluginSummary() {
    const plugins = Array.from(this.plugins.values());
    
    return {
      total: plugins.length,
      enabled: plugins.filter(p => p.enabled).length,
      disabled: plugins.filter(p => !p.enabled).length,
      triggers: this.triggerPlugins.size,
      events: this.eventPlugins.size,
      plugins: plugins.map(p => ({
        id: p.id,
        name: p.name,
        version: p.version,
        enabled: p.enabled,
        type: this.getPluginType(p)
      }))
    };
  }
  
  /**
   * Reload a plugin
   */
  async reloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' is not registered`);
    }
    
    this.logger.debug(`Reloading plugin: ${pluginId}`);
    
    try {
      // Cleanup current instance
      await plugin.cleanup();
      
      // Re-initialize
      await plugin.initialize();
      
      this.logger.log(`Successfully reloaded plugin: ${pluginId}`);
      
    } catch (error) {
      this.logger.error(`Failed to reload plugin '${pluginId}': ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Enable/disable a plugin
   */
  async setPluginEnabled(pluginId: string, enabled: boolean): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin '${pluginId}' is not registered`);
    }
    
    // Note: This would require plugins to support dynamic enable/disable
    // For now, we'll just log the request
    this.logger.log(`Plugin '${pluginId}' ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Register built-in plugins automatically
   */
  private async registerBuiltinPlugins(): Promise<void> {
    this.logger.debug('Registering built-in plugins...');
    
    try {
      // Import and instantiate plugins directly
      const { 
        CronTriggerPlugin, 
        ManualTriggerPlugin, 
        WebhookTriggerPlugin,
        HttpHealthCheckTriggerPlugin,
        FileSystemTriggerPlugin,
        ContainerStateTriggerPlugin,
        SystemResourceTriggerPlugin
      } = await import('../triggers');
      
      const {
        LogMessageEventPlugin,
        RestartContainerEventPlugin,
        DiscoverContainersEventPlugin,
        CheckContainerUpdatesEventPlugin,
        SendNotificationEventPlugin,
        ExecuteCommandEventPlugin,
        FileOperationsEventPlugin,
        ContainerManagementEventPlugin
      } = await import('../events');
      
      const pluginClasses = [
        // Trigger plugins
        CronTriggerPlugin,
        ManualTriggerPlugin,
        WebhookTriggerPlugin,
        HttpHealthCheckTriggerPlugin,
        FileSystemTriggerPlugin,
        ContainerStateTriggerPlugin,
        SystemResourceTriggerPlugin,
        
        // Event plugins
        LogMessageEventPlugin,
        RestartContainerEventPlugin,
        DiscoverContainersEventPlugin,
        CheckContainerUpdatesEventPlugin,
        SendNotificationEventPlugin,
        ExecuteCommandEventPlugin,
        FileOperationsEventPlugin,
        ContainerManagementEventPlugin
      ];
      
      for (const PluginClass of pluginClasses) {
        try {
          // Create plugin instance using NestJS dependency injection
          const plugin = await this.moduleRef.create(PluginClass);
          
          // Register plugin
          this.plugins.set(plugin.id, plugin);
          
          // Register type-specific plugins
          if (this.isTriggerPlugin(plugin)) {
            await this.registerTriggerPlugin(plugin);
          }
          
          if (this.isEventPlugin(plugin)) {
            await this.registerEventPlugin(plugin);
          }
          
          // Initialize plugin
          await plugin.initialize();
          
          this.logger.log(`Registered built-in plugin: ${plugin.name} (${plugin.id})`);
        } catch (error) {
          this.logger.error(`Failed to register built-in plugin '${PluginClass.name}': ${error.message}`);
        }
      }
      
    } catch (error) {
      this.logger.error('Error registering built-in plugins', error);
    }
  }
  
  /**
   * Auto-discover plugins from filesystem
   */
  private async discoverPlugins(): Promise<void> {
    this.logger.debug('Auto-discovering plugins...');
    
    const directories = this.config.pluginDirectories || [
      './plugins/triggers',
      './plugins/events'
    ];
    
    // Plugin discovery logic would go here
    // This involves scanning directories for plugin files
    // and dynamically loading them
  }
  
  /**
   * Register a trigger plugin
   */
  private async registerTriggerPlugin(plugin: ITriggerPlugin): Promise<void> {
    const triggerType = plugin.triggerType;
    
    if (this.triggerPlugins.has(triggerType)) {
      throw new Error(`Trigger type '${triggerType}' is already registered by another plugin`);
    }
    
    this.triggerPlugins.set(triggerType, plugin);
    this.logger.debug(`Registered trigger plugin for type: ${triggerType}`);
  }
  
  /**
   * Register an event plugin
   */
  private async registerEventPlugin(plugin: IEventPlugin): Promise<void> {
    const eventType = plugin.eventType;
    
    if (this.eventPlugins.has(eventType)) {
      throw new Error(`Event type '${eventType}' is already registered by another plugin`);
    }
    
    this.eventPlugins.set(eventType, plugin);
    this.logger.debug(`Registered event plugin for type: ${eventType}`);
  }
  
  /**
   * Check if plugin is a trigger plugin
   */
  private isTriggerPlugin(plugin: IPlugin): plugin is ITriggerPlugin {
    return 'triggerType' in plugin && 'evaluate' in plugin;
  }
  
  /**
   * Check if plugin is an event plugin
   */
  private isEventPlugin(plugin: IPlugin): plugin is IEventPlugin {
    return 'eventType' in plugin && 'execute' in plugin;
  }
  
  /**
   * Get plugin type as string
   */
  private getPluginType(plugin: IPlugin): string {
    const types: string[] = [];
    
    if (this.isTriggerPlugin(plugin)) {
      types.push('trigger');
    }
    
    if (this.isEventPlugin(plugin)) {
      types.push('event');
    }
    
    return types.length > 0 ? types.join(', ') : 'unknown';
  }
  
  /**
   * Get plugins that depend on the given plugin
   */
  private getPluginDependents(pluginId: string): string[] {
    const dependents: string[] = [];
    
    for (const [pid, deps] of this.dependencyGraph.entries()) {
      if (deps.includes(pluginId)) {
        dependents.push(pid);
      }
    }
    
    return dependents;
  }
  
  /**
   * Log plugin summary
   */
  private logPluginSummary(): void {
    const summary = this.getPluginSummary();
    
    this.logger.log(`Plugin Registry Summary:`);
    this.logger.log(`  Total: ${summary.total}`);
    this.logger.log(`  Enabled: ${summary.enabled}`);
    this.logger.log(`  Disabled: ${summary.disabled}`);
    this.logger.log(`  Triggers: ${summary.triggers}`);
    this.logger.log(`  Events: ${summary.events}`);
    
    if (summary.plugins.length > 0) {
      this.logger.debug('Registered plugins:');
      for (const plugin of summary.plugins) {
        this.logger.debug(`  - ${plugin.name} (${plugin.id}) v${plugin.version} [${plugin.type}] ${plugin.enabled ? '✓' : '✗'}`);
      }
    }
  }
}