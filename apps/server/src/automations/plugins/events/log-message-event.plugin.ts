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
      // Support both nested params format and direct config format
      const message = this.getConfigValue(config, 'message', '');
      if (!message) {
        return this.createFailureResult('Missing required parameter: message');
      }

      const level = this.getConfigValue(config, 'level', 'info') as string;
      const category = this.getConfigValue(config, 'category', 'automation');
      
      // Log to operation log (use context operationLogId if available)
      if (context.operationLogId) {
        this.operationLogService.log(level as any, message, undefined, context.operationLogId);
      } else {
        this.operationLogService.log(level as any, message);
      }
      
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
    // Check for message in both direct config and nested params
    const message = this.getConfigValue(config, 'message', '');
    if (!message) {
      this.logError('Required parameter "message" is missing');
      return false;
    }

    const level = this.getConfigValue(config, 'level', 'info');
    if (level && !['info', 'warn', 'error', 'debug'].includes(level)) {
      this.logError(`Invalid log level: ${level}. Must be one of: info, warn, error, debug`);
      return false;
    }

    return true;
  }
  
  /**
   * Get event configuration schema
   * Supports both direct format {message: "..."} and nested format {params: {message: "..."}}
   */
  public getEventConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        // Direct format properties
        message: {
          type: 'string',
          title: 'Message',
          description: 'The message to be logged',
          minLength: 1,
          placeholder: 'Enter your log message here',
          examples: [
            'Container restart completed successfully',
            'System backup initiated',
            'Alert: High CPU usage detected',
            'Maintenance task completed',
            'Rule executed successfully',
            'System health check passed'
          ]
        },
        level: {
          type: 'string',
          title: 'Log Level',
          description: 'Severity level of the log message',
          enum: ['info', 'warn', 'error', 'debug'],
          default: 'info'
        },
        // Legacy nested format support
        type: {
          type: 'string',
          const: 'log-message'
        },
        params: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              title: 'Message',
              description: 'The message to be logged',
              minLength: 1
            },
            level: {
              type: 'string',
              title: 'Log Level',
              description: 'Severity level of the log message',
              enum: ['info', 'warn', 'error', 'debug'],
              default: 'info'
            }
          },
          required: ['message']
        },
        enabled: {
          type: 'boolean',
          default: true
        }
      },
      required: ['message'],
      additionalProperties: true
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
          description: 'The message to be logged',
          minLength: 1,
          placeholder: 'Enter your log message here',
          examples: [
            'Rule executed successfully',
            'System check completed',
            'Action performed',
            'Task finished'
          ]
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