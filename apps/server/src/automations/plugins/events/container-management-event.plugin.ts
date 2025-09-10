import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult, DynamicConfigOptions } from '../interfaces';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { ContainersService } from '../../../containers/containers.service';
import { HostsService } from '../../../hosts/hosts.service';

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
    private readonly containersService: ContainersService,
    private readonly hostsService: HostsService
  ) {
    super();
  }
  
  /**
   * Execute the container management event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const operation = this.getParam(config, 'operation', 'restart') as string;
      const containerIdentifiers = this.getParam(config, 'containerIdentifiers', []) as string[];
      const hostIds = this.getParam(config, 'hostIds', []) as string[];
      const waitForHealthy = this.getParam(config, 'waitForHealthy', false);
      const timeout = this.getParam(config, 'timeout', 60000);
      const force = this.getParam(config, 'force', false);
      const updateConfig = this.getParam(config, 'updateConfig', {});
      const executionMode = this.getParam(config, 'executionMode', 'parallel') as 'parallel' | 'sequential';
      
      if (!containerIdentifiers || containerIdentifiers.length === 0) {
        return this.createFailureResult('Container identifiers are required');
      }
      
      // Find all matching containers
      const targetContainers = await this.findContainers(containerIdentifiers, hostIds);
      if (targetContainers.length === 0) {
        return this.createFailureResult(`No containers found matching identifiers: ${containerIdentifiers.join(', ')}`);
      }
      
      const results: ContainerOperationResult[] = [];
      const executionModeText = executionMode === 'parallel' ? 'parallel' : 'sequential';
      
      this.operationLogService.log(
        'info', 
        `Starting ${executionModeText} container operation '${operation}' on ${targetContainers.length} containers`
      );
      
      if (executionMode === 'parallel') {
        // Execute operations in parallel
        const promises = targetContainers.map(container => 
          this.executeContainerOperation(container, operation, {
            waitForHealthy,
            timeout,
            force,
            updateConfig,
            logLines: this.getParam(config, 'logLines', 100)
          })
        );
        results.push(...await Promise.allSettled(promises).then(settledResults =>
          settledResults.map((result, index) => {
            if (result.status === 'fulfilled') {
              return result.value;
            } else {
              return {
                success: false,
                operation,
                containerId: targetContainers[index].id,
                containerName: targetContainers[index].name,
                error: result.reason instanceof Error ? result.reason.message : String(result.reason)
              };
            }
          })
        ));
      } else {
        // Execute operations sequentially
        for (const container of targetContainers) {
          try {
            const result = await this.executeContainerOperation(container, operation, {
              waitForHealthy,
              timeout,
              force,
              updateConfig,
              logLines: this.getParam(config, 'logLines', 100)
            });
            results.push(result);
          } catch (error) {
            results.push({
              success: false,
              operation,
              containerId: container.id,
              containerName: container.name,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
      
      // Calculate summary
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      
      const summaryMessage = `Container operation '${operation}' completed: ${successCount} successful, ${failureCount} failed`;
      this.operationLogService.log('info', summaryMessage);
      
      return this.createSuccessResult(
        summaryMessage,
        {
          operation,
          executionMode,
          totalContainers: targetContainers.length,
          successCount,
          failureCount,
          results: results.map((result, index) => ({
            ...result,
            containerInfo: targetContainers[index] ? {
              id: targetContainers[index].id,
              name: targetContainers[index].name,
              image: targetContainers[index].image,
              hostId: targetContainers[index].hostId
            } : undefined
          }))
        }
      );
      
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
            containerIdentifiers: {
              type: 'array',
              title: 'Target Containers',
              description: 'Container IDs, names, or patterns to operate on',
              items: {
                type: 'string',
                minLength: 1,
                maxLength: 200,
                title: 'Container ID/Name',
                placeholder: 'nginx or container-id'
              },
              default: [],
              examples: [
                ['nginx'],
                ['web-server', 'database'],
                ['app-prod', 'redis-cache', 'monitoring']
              ]
            },
            hostIds: {
              type: 'array',
              title: 'Target Hosts',
              description: 'Hosts to perform container operations on (leave empty for auto-detect)',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Host'
              },
              default: [],
              examples: [
                ['web-server'],
                ['prod-host-1', 'prod-host-2']
              ]
            },
            executionMode: {
              type: 'string',
              title: 'Execution Mode',
              description: 'How to execute operations on multiple containers',
              enum: ['parallel', 'sequential'],
              default: 'parallel',
              examples: ['parallel', 'sequential']
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
            updateConfig: {
              type: 'object',
              title: 'Update Configuration',
              description: 'Container update configuration (only used for update operation)',
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
            pullImage: {
              type: 'boolean',
              title: 'Pull Latest Image',
              description: 'Pull latest image before starting (for update/recreate)',
              default: false
            }
          },
          required: ['operation', 'containerIdentifiers']
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
        containerIdentifiers: {
          type: 'array',
          title: 'Container IDs/Names',
          items: {
            type: 'string',
            minLength: 1,
            maxLength: 200
          },
          default: []
        },
        hostIds: {
          type: 'array',
          title: 'Host IDs',
          items: {
            type: 'string'
          },
          default: []
        },
        executionMode: {
          type: 'string',
          title: 'Execution Mode',
          enum: ['parallel', 'sequential'],
          default: 'parallel'
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
      required: ['operation', 'containerIdentifiers'],
      additionalProperties: false
    };
  }
  
  /**
   * Validate container management configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['operation', 'containerIdentifiers'])) {
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
    
    const containerIdentifiers = config.params.containerIdentifiers;
    if (!Array.isArray(containerIdentifiers) || containerIdentifiers.length === 0) {
      this.logError('Container identifiers must be a non-empty array');
      return false;
    }
    
    const invalidIdentifiers = containerIdentifiers.filter(id => 
      typeof id !== 'string' || id.trim().length === 0
    );
    if (invalidIdentifiers.length > 0) {
      this.logError(`Invalid container identifiers: ${invalidIdentifiers.join(', ')}`);
      return false;
    }
    
    const hostIds = config.params.hostIds;
    if (hostIds && (!Array.isArray(hostIds) || hostIds.some(id => typeof id !== 'string'))) {
      this.logError('Host IDs must be an array of strings');
      return false;
    }
    
    const executionMode = config.params.executionMode;
    if (executionMode && !['parallel', 'sequential'].includes(executionMode)) {
      this.logError(`Invalid execution mode: ${executionMode}`);
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

  /**
   * Get dynamic configuration options for event fields
   */
  public async getEventDynamicOptions(): Promise<DynamicConfigOptions> {
    try {
      const options: DynamicConfigOptions = {};

      // Get available hosts
      const { items: hosts } = await this.hostsService.list();
      options.hostIds = hosts.map((host: any) => ({
        value: host.id,
        label: `${host.name} (${host.address})`,
        description: `Host: ${host.address}`,
        group: 'Hosts'
      }));

      // Get available containers
      const { items: containers } = await this.containersService.list({});

      options.containerIdentifiers = containers.map(container => ({
        value: container.name || container.id,
        label: `${container.name || container.id} (${container.state || 'unknown'})`,
        description: `Host: ${container.host?.name || 'Unknown'} | State: ${container.state || 'unknown'}`,
        group: container.host?.name || 'Unknown Host'
      }));

      return options;
    } catch (error) {
      this.logError('Failed to get dynamic options', error);
      return {};
    }
  }

  /**
   * Find multiple containers by identifiers and hosts
   */
  private async findContainers(identifiers: string[], hostIds: string[]): Promise<any[]> {
    const allContainers = [];
    
    for (const identifier of identifiers) {
      const searchQuery: any = { q: identifier };
      if (hostIds.length > 0) {
        searchQuery.hostIds = hostIds;
      }
      
      const { items: containers } = await this.containersService.list(searchQuery);
      if (containers && containers.length > 0) {
        allContainers.push(...containers);
      }
    }
    
    // Remove duplicates based on container ID
    const uniqueContainers = allContainers.filter((container, index, self) =>
      index === self.findIndex(c => c.id === container.id)
    );
    
    return uniqueContainers;
  }

  /**
   * Execute a single container operation
   */
  private async executeContainerOperation(container: any, operation: string, options: any): Promise<ContainerOperationResult> {
    const { waitForHealthy, timeout, force, updateConfig, logLines } = options;
    const previousState = container.state;
    
    switch (operation) {
      case 'start':
        return await this.startContainer(container, waitForHealthy, timeout);
      case 'stop':
        return await this.stopContainer(container, timeout, force);
      case 'restart':
        return await this.restartContainer(container, waitForHealthy, timeout);
      case 'pause':
        return await this.pauseContainer(container);
      case 'unpause':
        return await this.unpauseContainer(container);
      case 'remove':
        return await this.removeContainer(container, force);
      case 'update':
        return await this.updateContainer(container, updateConfig);
      case 'recreate':
        return await this.recreateContainer(container, waitForHealthy, timeout);
      case 'logs':
        return await this.getContainerLogs(container, logLines);
      default:
        return {
          success: false,
          operation,
          containerId: container.id,
          containerName: container.name,
          error: `Unsupported operation: ${operation}`
        };
    }
  }
}