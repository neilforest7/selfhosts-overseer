import { Logger } from '@nestjs/common';
import { IPlugin } from '../interfaces';

/**
 * Base plugin class providing common functionality
 * All plugins should extend this class
 */
export abstract class BasePlugin implements IPlugin {
  protected readonly logger: Logger;
  
  public abstract readonly id: string;
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly version: string;
  
  public readonly author?: string;
  public readonly tags?: string[];
  public readonly enabled: boolean = true;
  public readonly configSchema?: Record<string, any>;
  public readonly dependencies?: string[];
  
  constructor() {
    this.logger = new Logger(this.constructor.name);
  }
  
  /**
   * Initialize the plugin
   * Override in subclasses for custom initialization
   */
  async initialize(): Promise<void> {
    this.logger.debug(`Initializing plugin: ${this.name} (${this.id})`);
  }
  
  /**
   * Cleanup the plugin
   * Override in subclasses for custom cleanup
   */
  async cleanup(): Promise<void> {
    this.logger.debug(`Cleaning up plugin: ${this.name} (${this.id})`);
  }
  
  /**
   * Validate plugin configuration
   * Override in subclasses for custom validation
   */
  validateConfig(config: any): boolean | Promise<boolean> {
    return true;
  }
  
  /**
   * Log info message with plugin context
   */
  protected logInfo(message: string, ...args: any[]): void {
    this.logger.log(`[${this.id}] ${message}`, ...args);
  }
  
  /**
   * Log debug message with plugin context
   */
  protected logDebug(message: string, ...args: any[]): void {
    this.logger.debug(`[${this.id}] ${message}`, ...args);
  }
  
  /**
   * Log warning message with plugin context
   */
  protected logWarn(message: string, ...args: any[]): void {
    this.logger.warn(`[${this.id}] ${message}`, ...args);
  }
  
  /**
   * Log error message with plugin context
   */
  protected logError(message: string, error?: any): void {
    this.logger.error(`[${this.id}] ${message}`, error);
  }
}