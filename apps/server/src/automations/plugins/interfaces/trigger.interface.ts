import { IPlugin } from './base.interface';

/**
 * Context information passed to triggers
 */
export interface TriggerContext {
  /** Current timestamp */
  timestamp: Date;
  
  /** System facts/data available to triggers */
  facts: Record<string, any>;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Result returned by trigger evaluation
 */
export interface TriggerResult {
  /** Whether the trigger should fire */
  shouldTrigger: boolean;
  
  /** Additional data to pass to the event */
  triggerData?: Record<string, any>;
  
  /** Reason for trigger decision (for debugging) */
  reason?: string;
  
  /** Next evaluation time (for optimization) */
  nextEvaluationTime?: Date;
}

/**
 * Trigger configuration schema
 */
export interface TriggerConfig {
  /** Trigger type identifier */
  type: string;
  
  /** Trigger-specific configuration */
  config: Record<string, any>;
  
  /** Whether this trigger is enabled */
  enabled?: boolean;
  
  /** Trigger conditions */
  conditions?: Record<string, any>;
}

/**
 * Interface for trigger plugins
 * Triggers determine WHEN automation rules should fire
 */
export interface ITriggerPlugin extends IPlugin {
  /** 
   * Trigger type this plugin handles
   * Must be unique across all trigger plugins
   */
  readonly triggerType: string;
  
  /**
   * Evaluate whether this trigger should fire
   * @param config Trigger configuration
   * @param context Current trigger context
   * @returns Promise<TriggerResult> indicating if trigger should fire
   */
  evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult>;
  
  /**
   * Get the next scheduled evaluation time for this trigger
   * Used for optimization to avoid unnecessary evaluations
   * @param config Trigger configuration
   * @returns Promise<Date | null> next evaluation time, or null if always evaluate
   */
  getNextEvaluationTime?(config: TriggerConfig): Promise<Date | null>;
  
  /**
   * Validate trigger-specific configuration
   * @param config Trigger configuration to validate
   * @returns boolean indicating if config is valid
   */
  validateTriggerConfig(config: TriggerConfig): boolean | Promise<boolean>;
  
  /**
   * Get trigger configuration schema
   * Used for UI generation and validation
   */
  getTriggerConfigSchema(): Record<string, any>;
  
  /**
   * Get available trigger conditions for this trigger type
   * Used for UI generation
   */
  getAvailableConditions?(): Record<string, any>;

  /**
   * Get dynamic configuration options for trigger fields
   * This allows triggers to provide dynamic data for dropdowns, etc.
   */
  getTriggerDynamicOptions?(): Promise<import('./base.interface').DynamicConfigOptions>;
}

/**
 * Trigger plugin registration
 */
export interface TriggerPluginRegistration {
  triggerType: string;
  plugin: ITriggerPlugin;
}