import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';
import { OperationLogService } from '../../../operation-log/operation-log.service';

/**
 * Log message event plugin
 * Logs messages to the operation log and system logger
 */
@Injectable()
export class LogMessageEventPlugin extends BaseEventPlugin {
  public readonly id = 'log-message-event';
  public readonly name = 'Log Message';
  public readonly description = 'Logs messages to the operation log and system logger';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['logging', 'message'];
  public readonly eventType = 'log-message';
  
  constructor(
    private readonly operationLogService: OperationLogService
  ) {
    super();
  }
  
  /**
   * Execute the log message event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      if (!this.validateRequiredParams(config, ['message'])) {
        return this.createFailureResult('Missing required parameter: message');
      }
      
      const message = this.getParam(config, 'message', '');
      const level = this.getParam(config, 'level', 'info');
      const category = this.getParam(config, 'category', 'automation');
      
      // Log to operation log
      this.operationLogService.log(level as any, message);
      
      // Log to system logger with category
      const contextMessage = `[${category}] ${message}`;
      switch (level) {
        case 'error':
          this.logError(contextMessage);
          break;
        case 'warn':
          this.logWarn(contextMessage);
          break;
        case 'debug':
          this.logDebug(contextMessage);
          break;
        default:
          this.logInfo(contextMessage);
      }
      
      return this.createSuccessResult(
        `Message logged successfully: ${message}`,
        { level, category, message },
        { loggedAt: new Date() }
      );
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to log message', error);
      return this.createFailureResult(`Failed to log message: ${errorMessage}`);
    }
  }
  
  /**
   * Validate log message configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['message'])) {
      return false;
    }
    
    const level = config.params.level;
    if (level && !['info', 'warn', 'error', 'debug'].includes(level)) {
      this.logError(`Invalid log level: ${level}. Must be one of: info, warn, error, debug`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get event configuration schema
   */
  public getEventConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'log-message'
        },
        params: {
          $ref: '#/definitions/LogMessageParams'
        },
        enabled: {
          type: 'boolean',
          default: true
        }
      },
      required: ['type', 'params'],
      definitions: {
        LogMessageParams: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              title: 'Message',
              description: 'Message to log',
              minLength: 1
            },
            level: {
              type: 'string',
              title: 'Log Level',
              description: 'Log level for the message',
              enum: ['info', 'warn', 'error', 'debug'],
              default: 'info'
            },
            category: {
              type: 'string',
              title: 'Category',
              description: 'Log category for organization',
              default: 'automation'
            }
          },
          required: ['message']
        }
      }
    };
  }
  
  /**
   * Get event parameter schema
   */
  public getEventParamsSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          title: 'Message',
          description: 'Message to log',
          minLength: 1
        },
        level: {
          type: 'string',
          title: 'Log Level',
          description: 'Log level for the message',
          enum: ['info', 'warn', 'error', 'debug'],
          default: 'info'
        },
        category: {
          type: 'string',
          title: 'Category',
          description: 'Log category for organization',
          default: 'automation'
        }
      },
      required: ['message'],
      additionalProperties: false
    };
  }
  
  /**
   * This event can always be executed safely
   */
  public async canExecute(config: EventConfig, context: EventContext): Promise<boolean> {
    return this.isEventEnabled(config);
  }
  
  /**
   * Log events execute very quickly
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    return 100; // 100ms
  }
  
  /**
   * Log events don't require elevated privileges
   */
  public requiresElevatedPrivileges(config: EventConfig): boolean {
    return false;
  }
}