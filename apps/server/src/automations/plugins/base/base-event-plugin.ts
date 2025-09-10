import { BasePlugin } from './base-plugin';
import {
  IEventPlugin,
  EventConfig,
  EventContext,
  EventResult,
  IPluginValidator,
  ValidationResult
} from '../interfaces';

/**
 * Base class for event plugins
 * Provides common event functionality and utilities
 */
export abstract class BaseEventPlugin extends BasePlugin implements IEventPlugin, IPluginValidator {
  public abstract readonly eventType: string;
  
  /**
   * Execute the event action
   */
  public abstract execute(config: EventConfig, context: EventContext): Promise<EventResult>;
  
  /**
   * Validate event-specific configuration
   * Default implementation validates basic structure but allows plugin-specific field requirements
   */
  public async validateEventConfig(config: EventConfig): Promise<boolean> {
    // Only validate type if it's provided - some plugins may not require it
    if (config.type && config.type !== this.eventType) {
      this.logError(`Invalid event type. Expected: ${this.eventType}, got: ${config.type}`);
      return false;
    }

    // Allow params to be undefined or null for plugins that don't require them
    // Only validate structure if params are provided
    if (config.params !== undefined && config.params !== null && typeof config.params !== 'object') {
      this.logError('Event params must be an object when provided');
      return false;
    }

    // Delegate to plugin-specific validation
    return this.validateCustomConfig(config);
  }
  
  /**
   * Get event configuration schema
   * Override in subclasses to provide specific schema
   */
  public abstract getEventConfigSchema(): Record<string, any>;

  /**
   * Implement IPluginValidator interface
   * Validates event configuration with detailed results
   */
  async validateConfig(config: any): Promise<ValidationResult> {
    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      const suggestions: string[] = [];

      // Basic structure validation
      if (!config || typeof config !== 'object') {
        errors.push('Configuration must be a valid object');
      } else {
        // Validate event-specific configuration
        const isValid = await this.validateEventConfig(config as EventConfig);
        if (!isValid) {
          errors.push('Event configuration validation failed');
        }
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestions,
        metadata: {
          pluginId: this.id,
          pluginVersion: this.version,
          validatedAt: new Date(),
          context: 'event-validation'
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        isValid: false,
        errors: [`Event validation error: ${errorMessage}`],
        metadata: {
          pluginId: this.id,
          pluginVersion: this.version,
          validatedAt: new Date(),
          context: 'event-validation-error'
        }
      };
    }
  }

  /**
   * Get validation schema (implements IPluginValidator)
   */
  getValidationSchema(): Record<string, any> {
    return this.getEventConfigSchema();
  }
  
  /**
   * Get event parameter schema
   * Override in subclasses to provide specific parameter schema
   */
  public abstract getEventParamsSchema(): Record<string, any>;
  
  /**
   * Check if this event can be executed safely
   * Default implementation returns true
   */
  public async canExecute(config: EventConfig, context: EventContext): Promise<boolean> {
    return this.isEventEnabled(config);
  }
  
  /**
   * Estimate execution time for this event
   * Default implementation returns 5 seconds
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    return 5000; // 5 seconds default
  }
  
  /**
   * Check if this event requires elevated privileges
   * Default implementation returns false
   */
  public requiresElevatedPrivileges(config: EventConfig): boolean {
    return false;
  }
  
  /**
   * Validate custom event configuration
   * Override in subclasses for custom validation logic
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    return true;
  }
  
  /**
   * Create a successful event result
   */
  protected createSuccessResult(
    message?: string,
    data?: Record<string, any>,
    metadata?: Record<string, any>
  ): EventResult {
    return {
      success: true,
      message,
      data,
      metadata
    };
  }
  
  /**
   * Create a failed event result
   */
  protected createFailureResult(
    error: string,
    data?: Record<string, any>,
    metadata?: Record<string, any>
  ): EventResult {
    return {
      success: false,
      error,
      data,
      metadata
    };
  }
  
  /**
   * Helper to check if event is enabled
   */
  protected isEventEnabled(config: EventConfig): boolean {
    return config.enabled !== false;
  }
  
  /**
   * Helper to get event parameter with default
   */
  protected getParam<T>(config: EventConfig, key: string, defaultValue: T): T {
    return config.params[key] !== undefined ? config.params[key] : defaultValue;
  }

  /**
   * Helper to get configuration value from either direct config or nested params
   * This supports both formats: {message: "..."} and {params: {message: "..."}}
   */
  protected getConfigValue<T>(config: EventConfig, key: string, defaultValue: T): T {
    // First check if the key exists directly in the config (for direct format)
    if ((config as any)[key] !== undefined) {
      return (config as any)[key];
    }

    // Then check in params (for nested format)
    if (config.params && config.params[key] !== undefined) {
      return config.params[key];
    }

    return defaultValue;
  }
  
  /**
   * Helper to validate required parameters
   */
  protected validateRequiredParams(config: EventConfig, requiredParams: string[]): boolean {
    for (const param of requiredParams) {
      if (config.params[param] === undefined || config.params[param] === null) {
        this.logError(`Required parameter '${param}' is missing from event configuration`);
        return false;
      }
    }
    return true;
  }
  
  /**
   * Helper to get timeout from config options
   */
  protected getTimeout(config: EventConfig, defaultTimeout: number = 30000): number {
    return config.options?.timeout || defaultTimeout;
  }
  
  /**
   * Helper to check if retry is enabled
   */
  protected shouldRetry(config: EventConfig): boolean {
    return config.options?.retry === true;
  }
  
  /**
   * Helper to get retry attempts
   */
  protected getRetryAttempts(config: EventConfig): number {
    return config.options?.retryAttempts || 3;
  }
  
  /**
   * Helper to get retry delay
   */
  protected getRetryDelay(config: EventConfig): number {
    return config.options?.retryDelay || 1000;
  }
  
  /**
   * Execute with retry logic
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: EventConfig,
    context: EventContext
  ): Promise<T> {
    const maxAttempts = this.shouldRetry(config) ? this.getRetryAttempts(config) : 1;
    const retryDelay = this.getRetryDelay(config);
    
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxAttempts) {
          this.logWarn(`Attempt ${attempt} failed, retrying in ${retryDelay}ms: ${lastError.message}`);
          await this.delay(retryDelay);
        } else {
          this.logError(`All ${maxAttempts} attempts failed: ${lastError.message}`);
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * Utility to delay execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}