import { BasePlugin } from './base-plugin';
import {
  ITriggerPlugin,
  TriggerConfig,
  TriggerContext,
  TriggerResult,
  IPluginValidator,
  ValidationResult,
  DynamicConfigOptions
} from '../interfaces';

/**
 * Base class for trigger plugins
 * Provides common trigger functionality and utilities
 */
export abstract class BaseTriggerPlugin extends BasePlugin implements ITriggerPlugin {
  public abstract readonly triggerType: string;
  
  /**
   * Evaluate whether this trigger should fire
   */
  public abstract evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult>;
  
  /**
   * Get the next scheduled evaluation time for this trigger
   * Default implementation returns null (always evaluate)
   */
  public async getNextEvaluationTime(config: TriggerConfig): Promise<Date | null> {
    return null; // Always evaluate by default
  }
  
  /**
   * Validate trigger-specific configuration
   * Default implementation validates basic structure
   */
  public async validateTriggerConfig(config: TriggerConfig): Promise<boolean> {
    if (!config.type || config.type !== this.triggerType) {
      this.logError(`Invalid trigger type. Expected: ${this.triggerType}, got: ${config.type}`);
      return false;
    }
    
    if (!config.config || typeof config.config !== 'object') {
      this.logError('Trigger config must be an object');
      return false;
    }
    
    return this.validateCustomConfig(config);
  }
  
  /**
   * Get trigger configuration schema
   * Override in subclasses to provide specific schema
   */
  public abstract getTriggerConfigSchema(): Record<string, any>;

  
  /**
   * Get validation schema (implements IPluginValidator)
   */
  getValidationSchema(): Record<string, any> {
    return this.getTriggerConfigSchema();
  }
  
  /**
   * Get available trigger conditions for this trigger type
   * Override in subclasses to provide specific conditions
   */
  public getAvailableConditions(): Record<string, any> {
    return {};
  }

  /**
   * Get dynamic configuration options for trigger fields
   * Override in subclasses to provide dynamic data
   */
  public async getTriggerDynamicOptions(): Promise<DynamicConfigOptions> {
    return this.getDynamicConfigOptions();
  }
  
  /**
   * Validate custom trigger configuration
   * Override in subclasses for custom validation logic
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    return true;
  }
  
  /**
   * Create a trigger result
   */
  protected createTriggerResult(
    shouldTrigger: boolean, 
    options: {
      triggerData?: Record<string, any>;
      reason?: string;
      nextEvaluationTime?: Date;
    } = {}
  ): TriggerResult {
    return {
      shouldTrigger,
      triggerData: options.triggerData,
      reason: options.reason,
      nextEvaluationTime: options.nextEvaluationTime
    };
  }
  
  /**
   * Helper to check if trigger is enabled
   */
  protected isTriggerEnabled(config: TriggerConfig): boolean {
    return config.enabled !== false;
  }
  
  /**
   * Helper to extract config value with default
   */
  protected getConfigValue<T>(config: TriggerConfig, key: string, defaultValue: T): T {
    return config.config[key] !== undefined ? config.config[key] : defaultValue;
  }
  
  /**
   * Helper to validate required config fields
   */
  protected validateRequiredFields(
    config: any,
    requiredFields: string[],
    fieldDisplayNames?: Record<string, string>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const field of requiredFields) {
      const value = config?.config?.[field] || config?.[field];
      const displayName = fieldDisplayNames?.[field] || field;

      if (value === undefined || value === null) {
        errors.push(`Required field '${displayName}' is missing`);
      } else if (typeof value === 'string' && value.trim() === '') {
        errors.push(`Required field '${displayName}' cannot be empty`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}