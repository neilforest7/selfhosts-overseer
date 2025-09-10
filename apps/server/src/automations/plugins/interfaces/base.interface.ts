import { ValidationResult } from './validation.interface';

/**
 * Base plugin interface that all automation plugins must implement
 */
export interface IPlugin {
  /** Unique plugin identifier */
  readonly id: string;
  
  /** Human-readable plugin name */
  readonly name: string;
  
  /** Plugin description */
  readonly description: string;
  
  /** Plugin version */
  readonly version: string;
  
  /** Plugin author */
  readonly author?: string;
  
  /** Plugin categories/tags */
  readonly tags?: string[];
  
  /** Whether this plugin is enabled */
  readonly enabled: boolean;
  
  /** Plugin configuration schema */
  readonly configSchema?: Record<string, any>;
  
  /** Plugin dependencies (other plugin IDs) */
  readonly dependencies?: string[];
  
  /**
   * Initialize the plugin
   * Called when the plugin is loaded
   */
  initialize(): Promise<void> | void;
  
  /**
   * Cleanup the plugin
   * Called when the plugin is unloaded
   */
  cleanup(): Promise<void> | void;
  
  /**
   * Validate plugin configuration
   * @deprecated Use the new ValidationResult interface instead
   */
  validateConfig?(config: any): boolean | Promise<boolean> | ValidationResult | Promise<ValidationResult>;
}

/**
 * Plugin metadata for registration
 */
export interface PluginMetadata {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  tags?: string[];
  enabled?: boolean;
  configSchema?: Record<string, any>;
  dependencies?: string[];
}

/**
 * Plugin registration information
 */
export interface PluginRegistration {
  metadata: PluginMetadata;
  pluginClass: new (...args: any[]) => IPlugin;
  config?: any;
}