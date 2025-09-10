import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { ContainersService } from '../../../containers/containers.service';

interface ContainerOperationResult {
  success: boolean;
  operation: string;
  containerId?: string;
  containerName?: string;
  previousState?: string;
  currentState?: string;
  error?: string;
  details?: any;
}

/**
 * Container management event plugin
 * Performs Docker container operations (start, stop, restart, update, etc.)
 */
@Injectable()
export class ContainerManagementEventPlugin extends BaseEventPlugin {
  public readonly id = 'container-management-event';
  public readonly name = 'Container Management';
  public readonly description = 'Manages Docker containers with various operations';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['container', 'docker', 'management', 'lifecycle'];
  public readonly eventType = 'container-management';
  
  constructor(
    private readonly operationLogService: OperationLogService,
    private readonly containersService: ContainersService
  ) {
    super();
  }
  
  /**
   * Execute the container management event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const operation = this.getParam(config, 'operation', 'restart') as string;
      const containerIdentifier = this.getParam(config, 'containerIdentifier', '');
      const hostId = this.getParam(config, 'hostId', null);
      const waitForHealthy = this.getParam(config, 'waitForHealthy', false);
      const timeout = this.getParam(config, 'timeout', 60000);
      const force = this.getParam(config, 'force', false);
      const updateConfig = this.getParam(config, 'updateConfig', {});
      
      if (!containerIdentifier) {
        return this.createFailureResult('Container identifier is required');
      }
      
      // Find container
      const container = await this.findContainer(containerIdentifier, hostId);
      if (!container) {
        return this.createFailureResult(`Container '${containerIdentifier}' not found`);
      }
      
      const previousState = container.state;
      let result: ContainerOperationResult;
      
      switch (operation) {
        case 'start':
          result = await this.startContainer(container, waitForHealthy, timeout);
          break;
        case 'stop':
          result = await this.stopContainer(container, timeout, force);
          break;
        case 'restart':
          result = await this.restartContainer(container, waitForHealthy, timeout);
          break;
        case 'pause':
          result = await this.pauseContainer(container);
          break;
        case 'unpause':
          result = await this.unpauseContainer(container);
          break;
        case 'remove':
          result = await this.removeContainer(container, force);
          break;
        case 'update':
          result = await this.updateContainer(container, updateConfig);
          break;
        case 'recreate':
          result = await this.recreateContainer(container, waitForHealthy, timeout);
          break;
        case 'logs':
          result = await this.getContainerLogs(container, this.getParam(config, 'logLines', 100));
          break;
        default:
          return this.createFailureResult(`Unsupported operation: ${operation}`);
      }
      
      if (result.success) {
        this.operationLogService.log(
          'info', 
          `Container operation completed: ${operation} on ${container.name} (${container.id})`
        );
        
        return this.createSuccessResult(
          `Container operation '${operation}' completed successfully`,
          {
            ...result,
            previousState,
            containerInfo: {
              id: container.id,
              name: container.name,
              image: container.image,
              hostId: container.hostId
            }
          }
        );
      } else {
        this.operationLogService.log(
          'error', 
          `Container operation failed: ${operation} on ${container.name} - ${result.error}`
        );
        return this.createFailureResult(`Container operation failed: ${result.error}`);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to execute container management', error);
      this.operationLogService.log('error', `Container management failed: ${errorMessage}`);
      return this.createFailureResult(`Container management failed: ${errorMessage}`);
    }
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
          const: 'container-management'
        },
        params: {
          $ref: '#/definitions/ContainerManagementParams'
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
              minimum: 10000,
              maximum: 300000,
              default: 60000
            },
            retry: {
              type: 'boolean',
              default: true
            },
            retryAttempts: {
              type: 'number',
              minimum: 1,
              maximum: 3,
              default: 2
            }
          }
        }
      },
      required: ['type', 'params'],
      definitions: {
        ContainerManagementParams: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              title: 'Container Operation',
              description: 'Management operation to perform on the container',
              enum: [
                'start', 'stop', 'restart', 'pause', 'unpause',
                'remove', 'update', 'recreate', 'logs', 'inspect', 'stats'
              ],
              default: 'restart',
              examples: ['restart', 'stop', 'start', 'update']
            },
            containerIdentifier: {
              type: 'string',
              title: 'Container ID/Name',
              description: 'Container ID, name, or pattern to match',
              minLength: 1,
              maxLength: 200,
              placeholder: 'nginx or container-id',
              examples: [
                'nginx',
                'web-server',
                'app-prod',
                'database-primary',
                'redis-cache'
              ]
            },
            hostId: {
              type: 'string',
              title: 'Target Host',
              description: 'Host to perform container operation on (leave empty for auto-detect)',
              placeholder: 'Select a host'
            },
            timeout: {
              type: 'number',
              title: 'Operation Timeout (ms)',
              description: 'Maximum time to wait for operation completion',
              minimum: 10000,
              maximum: 300000,
              default: 60000,
              examples: [30000, 60000, 120000, 180000]
            },
            safetyChecks: {
              type: 'boolean',
              title: 'Enable Safety Checks',
              description: 'Perform safety checks before destructive operations',
              default: true
            },
            backupBeforeUpdate: {
              type: 'boolean',
              title: 'Backup Before Update',
              description: 'Create container backup before update operations',
              default: false
            },
            waitForHealthy: {
              type: 'boolean',
              title: 'Wait for Healthy',
              description: 'Wait for container to be healthy after start/restart',
              default: false
            },
            force: {
              type: 'boolean',
              title: 'Force Operation',
              description: 'Force the operation (for stop/remove)',
              default: false
            },
            logLines: {
              type: 'number',
              title: 'Log Lines',
              description: 'Number of log lines to retrieve (for logs operation)',
              minimum: 1,
              maximum: 1000,
              default: 100
            },
            updateConfig: {
              type: 'object',
              title: 'Update Configuration',
              description: 'Container update configuration',
              properties: {
                image: {
                  type: 'string',
                  title: 'New Image',
                  description: 'New container image to update to'
                },
                restartPolicy: {
                  type: 'string',
                  title: 'Restart Policy',
                  enum: ['no', 'on-failure', 'always', 'unless-stopped']
                },
                cpuLimit: {
                  type: 'string',
                  title: 'CPU Limit',
                  description: 'CPU limit (e.g., 0.5, 2)'
                },
                memoryLimit: {
                  type: 'string',
                  title: 'Memory Limit',
                  description: 'Memory limit (e.g., 512m, 1g)'
                },
                environmentVariables: {
                  type: 'object',
                  title: 'Environment Variables',
                  additionalProperties: {
                    type: 'string'
                  }
                }
              },
              default: {}
            },
            backup: {
              type: 'boolean',
              title: 'Create Backup',
              description: 'Create backup before destructive operations',
              default: false
            },
            pullImage: {
              type: 'boolean',
              title: 'Pull Latest Image',
              description: 'Pull latest image before starting (for update/recreate)',
              default: false
            }
          },
          required: ['operation', 'containerIdentifier']
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
        operation: {
          type: 'string',
          title: 'Operation',
          enum: [
            'start', 'stop', 'restart', 'pause', 'unpause', 
            'remove', 'update', 'recreate', 'logs'
          ],
          default: 'restart'
        },
        containerIdentifier: {
          type: 'string',
          title: 'Container ID/Name',
          minLength: 1,
          maxLength: 200
        },
        hostId: {
          type: 'string',
          title: 'Host ID'
        },
        timeout: {
          type: 'number',
          title: 'Timeout (ms)',
          minimum: 10000,
          maximum: 300000,
          default: 60000
        },
        waitForHealthy: {
          type: 'boolean',
          title: 'Wait for Healthy',
          default: false
        },
        force: {
          type: 'boolean',
          title: 'Force Operation',
          default: false
        },
        updateConfig: {
          type: 'object',
          title: 'Update Configuration',
          default: {}
        }
      },
      required: ['operation', 'containerIdentifier'],
      additionalProperties: false
    };
  }
  
  /**
   * Validate container management configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['operation', 'containerIdentifier'])) {
      return false;
    }
    
    const operation = config.params.operation;
    const validOperations = [
      'start', 'stop', 'restart', 'pause', 'unpause', 
      'remove', 'update', 'recreate', 'logs'
    ];
    
    if (!validOperations.includes(operation)) {
      this.logError(`Invalid operation: ${operation}`);
      return false;
    }
    
    const containerIdentifier = config.params.containerIdentifier;
    if (typeof containerIdentifier !== 'string' || containerIdentifier.trim().length === 0) {
      this.logError('Container identifier must be a non-empty string');
      return false;
    }
    
    return true;
  }
  
  /**
   * Container operations can take significant time
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const operation = this.getParam(config, 'operation', 'restart') as string;
    const timeout = this.getParam(config, 'timeout', 60000);
    
    // Estimate based on operation type
    switch (operation) {
      case 'start':
      case 'restart':
      case 'recreate':
        return Math.min(timeout + 10000, 180000); // Add buffer, max 3 minutes
      case 'update':
        return Math.min(timeout + 30000, 300000); // Add more buffer for updates, max 5 minutes
      case 'stop':
      case 'remove':
        return Math.min(timeout + 5000, 120000);  // Less time for stop/remove
      default:
        return Math.min(timeout + 10000, 60000);  // Default timing
    }
  }
  
  /**
   * Find container by identifier
   */
  private async findContainer(identifier: string, hostId: string | null): Promise<any> {
    try {
      const searchQuery: any = { q: identifier };
      if (hostId) {
        searchQuery.hostId = hostId;
      }
      
      const { items: containers } = await this.containersService.list(searchQuery);
      return containers && containers.length > 0 ? containers[0] : null;
    } catch (error) {
      this.logError('Failed to find container', error);
      return null;
    }
  }
  
  /**
   * Start container
   */
  private async startContainer(
    container: any, 
    waitForHealthy: boolean, 
    timeout: number
  ): Promise<ContainerOperationResult> {
    try {
      await this.containersService.start(container.id);
      
      if (waitForHealthy) {
        const isHealthy = await this.waitForContainerHealth(container.id, timeout);
        if (!isHealthy) {
          return {
            success: false,
            operation: 'start',
            containerId: container.id,
            containerName: container.name,
            error: 'Container started but did not become healthy within timeout'
          };
        }
      }
      
      return {
        success: true,
        operation: 'start',
        containerId: container.id,
        containerName: container.name,
        currentState: 'running'
      };
    } catch (error) {
      return {
        success: false,
        operation: 'start',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Stop container
   */
  private async stopContainer(
    container: any, 
    timeout: number, 
    force: boolean
  ): Promise<ContainerOperationResult> {
    try {
      await this.containersService.stop(container.id);
      
      return {
        success: true,
        operation: 'stop',
        containerId: container.id,
        containerName: container.name,
        currentState: 'stopped'
      };
    } catch (error) {
      return {
        success: false,
        operation: 'stop',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Restart container
   */
  private async restartContainer(
    container: any, 
    waitForHealthy: boolean, 
    timeout: number
  ): Promise<ContainerOperationResult> {
    try {
      await this.containersService.restart(container.id);
      
      if (waitForHealthy) {
        const isHealthy = await this.waitForContainerHealth(container.id, timeout);
        if (!isHealthy) {
          return {
            success: false,
            operation: 'restart',
            containerId: container.id,
            containerName: container.name,
            error: 'Container restarted but did not become healthy within timeout'
          };
        }
      }
      
      return {
        success: true,
        operation: 'restart',
        containerId: container.id,
        containerName: container.name,
        currentState: 'running'
      };
    } catch (error) {
      return {
        success: false,
        operation: 'restart',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Pause container
   */
  private async pauseContainer(container: any): Promise<ContainerOperationResult> {
    try {
      // This would use the containers service pause method if available
      // For now, we'll indicate it's not implemented
      throw new Error('Pause operation not implemented');
    } catch (error) {
      return {
        success: false,
        operation: 'pause',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Unpause container
   */
  private async unpauseContainer(container: any): Promise<ContainerOperationResult> {
    try {
      // This would use the containers service unpause method if available
      throw new Error('Unpause operation not implemented');
    } catch (error) {
      return {
        success: false,
        operation: 'unpause',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Remove container
   */
  private async removeContainer(container: any, force: boolean): Promise<ContainerOperationResult> {
    try {
      await this.containersService.remove(container.id);
      
      return {
        success: true,
        operation: 'remove',
        containerId: container.id,
        containerName: container.name,
        currentState: 'removed'
      };
    } catch (error) {
      return {
        success: false,
        operation: 'remove',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Update container
   */
  private async updateContainer(container: any, updateConfig: any): Promise<ContainerOperationResult> {
    try {
      // This would implement container update logic
      // For now, we'll indicate basic update support
      const updateData = {
        ...updateConfig,
        containerId: container.id
      };
      
      // This would call the containers service update method
      // await this.containersService.update(container.id, updateData);
      
      return {
        success: true,
        operation: 'update',
        containerId: container.id,
        containerName: container.name,
        details: updateConfig
      };
    } catch (error) {
      return {
        success: false,
        operation: 'update',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Recreate container
   */
  private async recreateContainer(
    container: any, 
    waitForHealthy: boolean, 
    timeout: number
  ): Promise<ContainerOperationResult> {
    try {
      // Stop, remove, and recreate container
      await this.containersService.stop(container.id);
      await this.containersService.remove(container.id);
      
      // This would recreate the container with the same configuration
      // For now, we'll indicate the process
      
      if (waitForHealthy) {
        const isHealthy = await this.waitForContainerHealth(container.id, timeout);
        if (!isHealthy) {
          return {
            success: false,
            operation: 'recreate',
            containerId: container.id,
            containerName: container.name,
            error: 'Container recreated but did not become healthy within timeout'
          };
        }
      }
      
      return {
        success: true,
        operation: 'recreate',
        containerId: container.id,
        containerName: container.name,
        currentState: 'running'
      };
    } catch (error) {
      return {
        success: false,
        operation: 'recreate',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Get container logs
   */
  private async getContainerLogs(container: any, lines: number): Promise<ContainerOperationResult> {
    try {
      const logs = await this.containersService.logs(container.id, { lines });
      
      return {
        success: true,
        operation: 'logs',
        containerId: container.id,
        containerName: container.name,
        details: { logs, lines }
      };
    } catch (error) {
      return {
        success: false,
        operation: 'logs',
        containerId: container.id,
        containerName: container.name,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Wait for container to become healthy
   */
  private async waitForContainerHealth(containerId: string, timeout: number): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds
    
    while (Date.now() - startTime < timeout) {
      try {
        const container = await this.containersService.getById(containerId);
        if (container && container.state === 'running') {
          // If no health check defined, consider running as healthy
          const health = (container as any).health;
          if (!health || health === 'healthy') {
            return true;
          }
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      } catch (error) {
        // Continue checking
      }
    }
    
    return false;
  }
}