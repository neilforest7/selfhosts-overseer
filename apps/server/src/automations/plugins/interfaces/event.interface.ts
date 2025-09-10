import { IPlugin } from './base.interface';
import { TriggerResult } from './trigger.interface';

/**
 * Context information passed to event handlers
 */
export interface EventContext {
  /** Event parameters */
  params: Record<string, any>;
  
  /** Trigger result that caused this event */
  triggerResult?: TriggerResult;
  
  /** Rule information */
  rule: {
    id: string;
    name: string;
    description?: string;
  };
  
  /** Operation log ID for tracking */
  operationLogId: string;
  
  /** Additional context */
  metadata?: Record<string, any>;
}

/**
 * Result returned by event execution
 */
export interface EventResult {
  /** Whether the event executed successfully */
  success: boolean;
  
  /** Result message */
  message?: string;
  
  /** Result data */
  data?: Record<string, any>;
  
  /** Error information if failed */
  error?: string;
  
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Event configuration schema
 */
export interface EventConfig {
  /** Event type identifier */
  type: string;
  
  /** Event-specific parameters */
  params: Record<string, any>;
  
  /** Whether this event is enabled */
  enabled?: boolean;
  
  /** Event execution options */
  options?: {
    /** Timeout for event execution */
    timeout?: number;
    
    /** Whether to retry on failure */
    retry?: boolean;
    
    /** Number of retry attempts */
    retryAttempts?: number;
    
    /** Delay between retries */
    retryDelay?: number;
  };
}

/**
 * Interface for event plugins
 * Events define WHAT ACTIONS to take when automation rules fire
 */
export interface IEventPlugin extends IPlugin {
  /** 
   * Event type this plugin handles
   * Must be unique across all event plugins
   */
  readonly eventType: string;
  
  /**
   * Execute the event action
   * @param config Event configuration
   * @param context Event execution context
   * @returns Promise<EventResult> indicating execution result
   */
  execute(config: EventConfig, context: EventContext): Promise<EventResult>;
  
  /**
   * Validate event-specific configuration
   * @param config Event configuration to validate
   * @returns boolean indicating if config is valid
   */
  validateEventConfig(config: EventConfig): boolean | Promise<boolean>;
  
  /**
   * Get event configuration schema
   * Used for UI generation and validation
   */
  getEventConfigSchema(): Record<string, any>;
  
  /**
   * Get event parameter schema
   * Used for UI generation and validation
   */
  getEventParamsSchema(): Record<string, any>;
  
  /**
   * Check if this event can be executed safely
   * Called before execution to prevent dangerous operations
   * @param config Event configuration
   * @param context Event execution context
   * @returns boolean indicating if event is safe to execute
   */
  canExecute?(config: EventConfig, context: EventContext): boolean | Promise<boolean>;
  
  /**
   * Estimate execution time for this event
   * Used for scheduling and UI feedback
   * @param config Event configuration
   * @returns Estimated execution time in milliseconds
   */
  getEstimatedExecutionTime?(config: EventConfig): number;
  
  /**
   * Check if this event requires elevated privileges
   * @param config Event configuration
   * @returns boolean indicating if elevated privileges are needed
   */
  requiresElevatedPrivileges?(config: EventConfig): boolean;

  /**
   * Get dynamic configuration options for event fields
   * This allows events to provide dynamic data for dropdowns, etc.
   */
  getEventDynamicOptions?(): Promise<import('./base.interface').DynamicConfigOptions>;
}

/**
 * Event plugin registration
 */
export interface EventPluginRegistration {
  eventType: string;
  plugin: IEventPlugin;
}