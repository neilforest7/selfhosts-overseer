import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';
import { ContainersService } from '../../../containers/containers.service';
import { OperationLogService } from '../../../operation-log/operation-log.service';

/**
 * Restart container event plugin
 * Restarts Docker containers by ID or name
 */
@Injectable()
export class RestartContainerEventPlugin extends BaseEventPlugin {
  public readonly id = 'restart-container-event';
  public readonly name = 'Restart Container';
  public readonly description = 'Restarts Docker containers by ID or name';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['docker', 'container', 'restart'];
  public readonly eventType = 'restart-container';
  
  constructor(
    private readonly containersService: ContainersService,
    private readonly operationLogService: OperationLogService
  ) {
    super();
  }
  
  /**
   * Execute the restart container event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      if (!this.validateRequiredParams(config, ['containerId'])) {
        return this.createFailureResult('Missing required parameter: containerId');
      }
      
      const containerId = this.getParam(config, 'containerId', '');
      const force = this.getParam(config, 'force', false);
      const timeout = this.getParam(config, 'timeout', 30);
      
      this.operationLogService.log('info', `Looking for container: ${containerId}`);
      
      // Find container by ID or name
      const { items: containers } = await this.containersService.list({ q: containerId });
      if (!containers || containers.length === 0) {
        const error = `Container with ID/Name "${containerId}" not found`;
        this.operationLogService.log('error', error);
        return this.createFailureResult(error);
      }
      
      const targetContainer = containers[0];
      this.operationLogService.log('info', `Found container "${targetContainer.name}" on host ${targetContainer.hostId}, restarting...`);
      
      // Execute restart with retry logic if enabled
      return await this.executeWithRetry(async () => {
        await this.containersService.restartOne(
          { id: targetContainer.hostId }, 
          targetContainer.id,
          { force, timeout }
        );
        
        const successMessage = `Container "${targetContainer.name}" restarted successfully`;
        this.operationLogService.log('info', successMessage);
        
        return this.createSuccessResult(
          successMessage,
          {
            containerId: targetContainer.id,
            containerName: targetContainer.name,
            hostId: targetContainer.hostId,
            restartedAt: new Date()
          }
        );
      }, config, context);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to restart container', error);
      this.operationLogService.log('error', `Failed to restart container: ${errorMessage}`);
      return this.createFailureResult(`Failed to restart container: ${errorMessage}`);
    }
  }
  
  /**
   * Validate restart container configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['containerId'])) {
      return false;
    }
    
    const timeout = config.params.timeout;
    if (timeout !== undefined && (typeof timeout !== 'number' || timeout <= 0)) {
      this.logError('timeout must be a positive number');
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
          const: 'restart-container'
        },
        params: {
          $ref: '#/definitions/RestartContainerParams'
        },
        enabled: {
          type: 'boolean',
          default: true
        },
        options: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              minimum: 1000,
              maximum: 300000,
              default: 30000
            },
            retry: {
              type: 'boolean',
              default: true
            },
            retryAttempts: {
              type: 'number',
              minimum: 1,
              maximum: 5,
              default: 3
            }
          }
        }
      },
      required: ['type', 'params'],
      definitions: {
        RestartContainerParams: {
          type: 'object',
          properties: {
            containerId: {
              type: 'string',
              title: 'Container ID/Name',
              description: 'Container ID or name to restart',
              minLength: 1
            },
            force: {
              type: 'boolean',
              title: 'Force Restart',
              description: 'Force restart even if container is not running',
              default: false
            },
            timeout: {
              type: 'number',
              title: 'Timeout (seconds)',
              description: 'Timeout for restart operation',
              minimum: 1,
              maximum: 300,
              default: 30
            }
          },
          required: ['containerId']
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
        containerId: {
          type: 'string',
          title: 'Container ID/Name',
          description: 'Container ID or name to restart',
          minLength: 1
        },
        force: {
          type: 'boolean',
          title: 'Force Restart',
          description: 'Force restart even if container is not running',
          default: false
        },
        timeout: {
          type: 'number',
          title: 'Timeout (seconds)',
          description: 'Timeout for restart operation',
          minimum: 1,
          maximum: 300,
          default: 30
        }
      },
      required: ['containerId'],
      additionalProperties: false
    };
  }
  
  /**
   * Check if restart can be executed (container must exist and be accessible)
   */
  public async canExecute(config: EventConfig, context: EventContext): Promise<boolean> {
    if (!this.isEventEnabled(config)) {
      return false;
    }
    
    try {
      const containerId = this.getParam(config, 'containerId', '');
      if (!containerId) {
        return false;
      }
      
      // Check if container exists
      const { items: containers } = await this.containersService.list({ q: containerId });
      return containers && containers.length > 0;
    } catch (error) {
      this.logError('Error checking if container restart can be executed', error);
      return false;
    }
  }
  
  /**
   * Container restart typically takes 10-30 seconds
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const timeout = this.getParam(config, 'timeout', 30);
    return (timeout + 10) * 1000; // Add 10 seconds buffer
  }
  
  /**
   * Container restart may require elevated privileges depending on setup
   */
  public requiresElevatedPrivileges(config: EventConfig): boolean {
    return true; // Docker operations typically require elevated privileges
  }
}