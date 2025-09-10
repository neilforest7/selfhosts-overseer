import { ValidationResult } from './validation.interface';

/**
 * Dynamic configuration option for plugin fields
 */
export interface DynamicConfigOption {
  value: string | number;
  label: string;
  description?: string;
  disabled?: boolean;
  group?: string;
}

/**
 * Dynamic configuration options for a plugin field
 */
export interface DynamicConfigOptions {
  [fieldName: string]: DynamicConfigOption[];
}

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
   * Returns ValidationResult for detailed validation results
   */
  validateConfig?(config: any): ValidationResult | Promise<ValidationResult>;

  /**
   * Get dynamic configuration options for plugin fields
   * This allows plugins to provide dynamic data for dropdowns, etc.
   */
  getDynamicConfigOptions?(): Promise<DynamicConfigOptions> | DynamicConfigOptions;
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