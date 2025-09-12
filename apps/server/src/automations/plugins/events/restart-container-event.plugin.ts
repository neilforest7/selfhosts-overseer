import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult, DynamicConfigOptions } from '../interfaces';
import { ContainersService } from '../../../containers/containers.service';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { HostsService } from '../../../hosts/hosts.service';

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
    private readonly operationLogService: OperationLogService,
    private readonly hostsService: HostsService
  ) {
    super();
  }
  
  /**
   * Execute the restart container event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      if (!this.validateRequiredParams(config, ['containerIds'])) {
        return this.createFailureResult('Missing required parameter: containerIds');
      }
      
      const containerIds = this.getParam(config, 'containerIds', []) as string[];
      const hostIds = this.getParam(config, 'hostIds', []) as string[];
      const force = this.getParam(config, 'force', false);
      const timeout = this.getParam(config, 'timeout', 30);
      const executionMode = this.getParam(config, 'executionMode', 'parallel') as 'parallel' | 'sequential';
      
      if (!containerIds || containerIds.length === 0) {
        return this.createFailureResult('Container IDs are required');
      }
      
      // Find all target containers
      const targetContainers = await this.findContainers(containerIds, hostIds);
      if (targetContainers.length === 0) {
        const error = `No containers found matching identifiers: ${containerIds.join(', ')}`;
        this.operationLogService.log('error', error);
        return this.createFailureResult(error);
      }
      
      this.operationLogService.log('info', `Found ${targetContainers.length} containers to restart in ${executionMode} mode`);
      
      // Execute restarts
      const results = await this.restartContainers(targetContainers, executionMode, force, timeout, config, context);
      
      // Calculate summary
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      
      const summaryMessage = `Container restart operation completed: ${successCount} successful, ${failureCount} failed`;
      this.operationLogService.log('info', summaryMessage);
      
      return this.createSuccessResult(
        summaryMessage,
        {
          totalContainers: targetContainers.length,
          successCount,
          failureCount,
          executionMode,
          results: results.map((result, index) => ({
            ...result,
            containerInfo: targetContainers[index] ? {
              id: targetContainers[index].id,
              name: targetContainers[index].name,
              hostId: targetContainers[index].hostId
            } : undefined
          }))
        }
      );
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to restart containers', error);
      this.operationLogService.log('error', `Failed to restart containers: ${errorMessage}`);
      return this.createFailureResult(`Failed to restart containers: ${errorMessage}`);
    }
  }
  
  /**
   * Validate restart container configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['containerIds'])) {
      return false;
    }
    
    const containerIds = this.getParam(config, 'containerIds', []);
    if (!Array.isArray(containerIds) || containerIds.length === 0) {
      this.logError('containerIds must be a non-empty array');
      return false;
    }
    
    const invalidContainerIds = containerIds.filter(id => typeof id !== 'string' || (id as string).trim() === '');
    if (invalidContainerIds.length > 0) {
      this.logError(`Invalid container IDs: ${invalidContainerIds.join(', ')}`);
      return false;
    }
    
    const hostIds = this.getParam(config, 'hostIds', []);
    if (Array.isArray(hostIds) && hostIds.length > 0) {
      const invalidHostIds = hostIds.filter(id => typeof id !== 'string' || (id as string).trim() === '');
      if (invalidHostIds.length > 0) {
        this.logError(`Invalid host IDs: ${invalidHostIds.join(', ')}`);
        return false;
      }
    }
    
    const timeout = this.getParam(config, 'timeout', 30);
    if (typeof timeout !== 'number' || timeout <= 0) {
      this.logError('timeout must be a positive number');
      return false;
    }
    
    const executionMode = this.getParam(config, 'executionMode', 'parallel');
    if (!['parallel', 'sequential'].includes(executionMode)) {
      this.logError('executionMode must be either "parallel" or "sequential"');
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
            containerIds: {
              type: 'array',
              title: 'Containers to Restart',
              description: 'Container IDs, names, or patterns to restart',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Container ID/Name',
                placeholder: 'nginx, web-app, or container-id'
              },
              minItems: 1,
              default: ['nginx'],
              examples: [['nginx'], ['web-app', 'database'], ['redis-cache', 'postgres-primary']]
            },
            hostIds: {
              type: 'array',
              title: 'Target Hosts',
              description: 'Specific hosts to restart containers on (leave empty for auto-detect)',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Host ID'
              },
              default: [],
              examples: [['web-server'], ['prod-host-1', 'prod-host-2']]
            },
            force: {
              type: 'boolean',
              title: 'Force Restart',
              description: 'Force restart even if container is not running or healthy',
              default: false
            },
            timeout: {
              type: 'number',
              title: 'Timeout (seconds)',
              description: 'Maximum time to wait for each restart operation',
              minimum: 1,
              maximum: 300,
              default: 30,
              examples: [30, 60, 120]
            },
            gracefulShutdown: {
              type: 'boolean',
              title: 'Graceful Shutdown',
              description: 'Allow container to shutdown gracefully before forcing',
              default: true
            },
            waitForHealthy: {
              type: 'boolean',
              title: 'Wait for Healthy',
              description: 'Wait for container to become healthy after restart',
              default: false
            },
            executionMode: {
              type: 'string',
              title: 'Execution Mode',
              description: 'How to execute multiple container restarts',
              enum: ['parallel', 'sequential'],
              default: 'parallel',
              examples: ['parallel', 'sequential']
            }
          },
          required: ['containerIds']
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
        containerIds: {
          type: 'array',
          title: 'Containers to Restart',
          description: 'Container IDs, names, or patterns to restart',
          items: {
            type: 'string',
            minLength: 1
          },
          minItems: 1
        },
        hostIds: {
          type: 'array',
          title: 'Target Hosts',
          description: 'Specific hosts to restart containers on',
          items: {
            type: 'string',
            minLength: 1
          },
          default: []
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
          description: 'Timeout for each restart operation',
          minimum: 1,
          maximum: 300,
          default: 30
        },
        executionMode: {
          type: 'string',
          title: 'Execution Mode',
          description: 'How to execute multiple container restarts',
          enum: ['parallel', 'sequential'],
          default: 'parallel'
        }
      },
      required: ['containerIds'],
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
      const containerIds = this.getParam(config, 'containerIds', []);
      if (!Array.isArray(containerIds) || containerIds.length === 0) {
        return false;
      }
      
      // Check if at least one container exists
      for (const containerId of containerIds) {
        const { items: containers } = await this.containersService.list({ q: containerId });
        if (containers && containers.length > 0) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.logError('Error checking if container restart can be executed', error);
      return false;
    }
  }
  
  /**
   * Container restart typically takes 10-30 seconds per container
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const containerIds = this.getParam(config, 'containerIds', []);
    const timeout = this.getParam(config, 'timeout', 30);
    const executionMode = this.getParam(config, 'executionMode', 'parallel');
    
    if (executionMode === 'parallel') {
      return (timeout + 10) * 1000; // Parallel: add buffer time
    } else {
      // Sequential: multiply by number of containers
      return (timeout + 10) * 1000 * containerIds.length;
    }
  }
  
  /**
   * Container restart may require elevated privileges depending on setup
   */
  public requiresElevatedPrivileges(config: EventConfig): boolean {
    return true; // Docker operations typically require elevated privileges
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

      options.containerIds = containers.map(container => ({
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
   * Find containers matching the provided identifiers and host filters
   */
  private async findContainers(containerIds: string[], hostIds: string[]): Promise<any[]> {
    const targetContainers = [];

    for (const containerId of containerIds) {
      const searchQuery: any = { q: containerId };
      if (hostIds.length > 0) {
        searchQuery.hostIds = hostIds;
      }

      const { items: containers } = await this.containersService.list(searchQuery);
      if (containers && containers.length > 0) {
        targetContainers.push(...containers);
      }
    }

    return targetContainers;
  }

  /**
   * Restart containers with the specified execution mode
   */
  private async restartContainers(
    containers: any[],
    executionMode: 'parallel' | 'sequential',
    force: boolean,
    timeout: number,
    config: EventConfig,
    context: EventContext
  ): Promise<any[]> {
    const results = [];

    if (executionMode === 'parallel') {
      // Execute restarts in parallel
      const promises = containers.map(container => 
        this.restartSingleContainer(container, force, timeout, config, context)
      );
      const settledResults = await Promise.allSettled(promises);
      
      for (const result of settledResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            success: false,
            error: result.reason instanceof Error ? result.reason.message : String(result.reason)
          });
        }
      }
    } else {
      // Execute restarts sequentially
      for (const container of containers) {
        try {
          const result = await this.restartSingleContainer(container, force, timeout, config, context);
          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    return results;
  }

  /**
   * Restart a single container
   */
  private async restartSingleContainer(
    container: any,
    force: boolean,
    timeout: number,
    config: EventConfig,
    context: EventContext
  ): Promise<any> {
    try {
      this.operationLogService.log('info', `Restarting container ${container.name || container.id} on host ${container.host?.name || 'Unknown'}`);
      
      // Use the containers service to restart the container
      const result = await this.containersService.restart(container.id, container.hostId);
      
      return {
        success: true,
        containerId: container.id,
        containerName: container.name,
        hostId: container.hostId,
        message: `Container ${container.name || container.id} restarted successfully`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Failed to restart container ${container.name || container.id}: ${errorMessage}`);
      
      return {
        success: false,
        containerId: container.id,
        containerName: container.name,
        hostId: container.hostId,
        error: errorMessage
      };
    }
  }
}