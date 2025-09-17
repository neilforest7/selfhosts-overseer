import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult, DynamicConfigOptions } from '../interfaces';
import { ContainersService } from '../../../containers/containers.service';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { HostsService } from '../../../hosts/hosts.service';

/**
 * Discover containers event plugin
 * Discovers containers on specified hosts
 */
@Injectable()
export class DiscoverContainersEventPlugin extends BaseEventPlugin {
  public readonly id = 'discover-containers-event';
  public readonly name = 'Discover Containers';
  public readonly description = 'Discovers containers on specified hosts';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['docker', 'container', 'discovery'];
  public readonly eventType = 'discover-containers';
  
  constructor(
    private readonly containersService: ContainersService,
    private readonly operationLogService: OperationLogService,
    private readonly hostsService: HostsService
  ) {
    super();
  }
  
  /**
   * Execute the discover containers event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const hostIds = this.getParam(config, 'hostIds', []) as string[];
      const includeStoppedContainers = this.getParam(config, 'includeStoppedContainers', true);
      const executionMode = this.getParam(config, 'executionMode', 'parallel') as 'parallel' | 'sequential';
      
      if (!hostIds || hostIds.length === 0) {
        const error = 'hostIds is required for discover-containers event';
        this.operationLogService.log('error', error);
        return this.createFailureResult(error);
      }
      
      this.operationLogService.log('info', `Starting container discovery for ${hostIds.length} hosts in ${executionMode} mode`);
      
      // Find all target hosts
      const targetHosts = await this.findHosts(hostIds);
      if (targetHosts.length === 0) {
        const error = `No hosts found matching identifiers: ${hostIds.join(', ')}`;
        this.operationLogService.log('error', error);
        return this.createFailureResult(error);
      }
      
      // Execute discovery on all hosts
      const results = await this.discoverContainersOnHosts(targetHosts, executionMode, includeStoppedContainers, config, context);
      
      // Calculate summary
      const successCount = results.filter(r => r.success).length;
      const failureCount = results.length - successCount;
      
      const summaryMessage = `Container discovery operation completed: ${successCount} successful, ${failureCount} failed`;
      this.operationLogService.log('info', summaryMessage);
      
      return this.createSuccessResult(
        summaryMessage,
        {
          totalHosts: targetHosts.length,
          successCount,
          failureCount,
          executionMode,
          includeStoppedContainers,
          discoveredAt: new Date(),
          results: results.map((result, index) => ({
            ...result,
            hostInfo: targetHosts[index] ? {
              id: targetHosts[index].id,
              name: targetHosts[index].name,
              address: targetHosts[index].address
            } : undefined
          }))
        }
      );
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to discover containers', error);
      this.operationLogService.log('error', `Container discovery failed: ${errorMessage}`);
      return this.createFailureResult(`Container discovery failed: ${errorMessage}`);
    }
  }
  
  /**
   * Validate discover containers configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['hostIds'])) {
      return false;
    }
    
    const hostIds = this.getParam(config, 'hostIds', []);
    if (!Array.isArray(hostIds) || hostIds.length === 0) {
      this.logError('hostIds must be a non-empty array');
      return false;
    }
    
    const invalidHostIds = hostIds.filter(id => typeof id !== 'string' || (id as string).trim() === '');
    if (invalidHostIds.length > 0) {
      this.logError(`Invalid host IDs: ${invalidHostIds.join(', ')}`);
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
          const: 'discover-containers'
        },
        params: {
          $ref: '#/definitions/DiscoverContainersParams'
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
            }
          }
        }
      },
      required: ['type', 'params'],
      definitions: {
        DiscoverContainersParams: {
          type: 'object',
          properties: {
            hostIds: {
              type: 'array',
              title: 'Target Hosts',
              description: 'Hosts to discover containers on',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Host ID'
              },
              minItems: 1,
              default: ['web-server'],
              examples: [['web-server'], ['prod-host-1', 'prod-host-2'], ['monitoring', 'logging', 'database']]
            },
            includeStoppedContainers: {
              type: 'boolean',
              title: 'Include Stopped Containers',
              description: 'Whether to include stopped/exited containers in discovery results',
              default: true
            },
            containerNameFilter: {
              type: 'string',
              title: 'Container Name Filter',
              description: 'Filter containers by name pattern (glob syntax)',
              placeholder: '*web*',
              examples: ['*web*', 'app-*', '*-prod', 'nginx*']
            },
            imageFilter: {
              type: 'string',
              title: 'Image Filter',
              description: 'Filter containers by image name pattern',
              placeholder: 'nginx:*',
              examples: ['nginx:*', '*:latest', 'myapp/*', 'registry.com/*']
            },
            executionMode: {
              type: 'string',
              title: 'Execution Mode',
              description: 'How to execute discovery on multiple hosts',
              enum: ['parallel', 'sequential'],
              default: 'parallel',
              examples: ['parallel', 'sequential']
            }
          },
          required: ['hostIds']
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
        hostIds: {
          type: 'array',
          title: 'Target Hosts',
          description: 'Host IDs to discover containers on',
          items: {
            type: 'string',
            minLength: 1
          },
          minItems: 1
        },
        includeStoppedContainers: {
          type: 'boolean',
          title: 'Include Stopped Containers',
          description: 'Whether to include stopped containers in discovery',
          default: true
        },
        executionMode: {
          type: 'string',
          title: 'Execution Mode',
          description: 'How to execute discovery on multiple hosts',
          enum: ['parallel', 'sequential'],
          default: 'parallel'
        }
      },
      required: ['hostIds'],
      additionalProperties: false
    };
  }
  
  /**
   * Get dynamic configuration options for event fields
   */
  public async getEventDynamicOptions(): Promise<DynamicConfigOptions> {
    try {
      const options: DynamicConfigOptions = {};

      // Get available hosts
      const { items: hosts } = await this.hostsService.list();
      const hostOptions = hosts.map((host: any) => ({
        value: host.id,
        label: `${host.name} (${host.address})`,
        description: `Host: ${host.address}`,
        group: 'Hosts'
      }));

      options.hostIds = hostOptions;

      return options;
    } catch (error) {
      this.logError('Failed to get dynamic options', error);
      return {};
    }
  }

  /**
   * Discovery typically takes 30-120 seconds depending on host count
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const hostIds = this.getParam(config, 'hostIds', []);
    const executionMode = this.getParam(config, 'executionMode', 'parallel');
    
    if (executionMode === 'parallel') {
      return 60000; // Parallel: ~60 seconds total
    } else {
      // Sequential: multiply by number of hosts
      return 30000 * hostIds.length;
    }
  }
  
  /**
   * Container discovery requires SSH access to hosts
   */
  public requiresElevatedPrivileges(_config: EventConfig): boolean {
    return true; // Requires SSH access to hosts
  }

  /**
   * Find hosts matching the provided identifiers
   */
  private async findHosts(hostIdentifiers: string[]): Promise<any[]> {
    const targetHosts = [];

    for (const identifier of hostIdentifiers) {
      // 优先按主机ID精确查找
      try {
        const hostById = await this.hostsService.findOne(identifier).catch(() => null);
        if (hostById) {
          targetHosts.push(hostById);
          continue;
        }
      } catch (error) {
        // 忽略 findOne 抛出的未找到错误，继续按标签回退查询
      }

      // 回退：按标签匹配（保持与原有行为兼容）
      try {
        const { items: hostsByTag } = await this.hostsService.list(identifier);
        if (hostsByTag && hostsByTag.length > 0) {
          targetHosts.push(...hostsByTag);
        }
      } catch (error) {
        this.logError(`Error finding host with identifier ${identifier}`, error);
      }
    }

    return targetHosts;
  }

  /**
   * Discover containers on multiple hosts with the specified execution mode
   */
  private async discoverContainersOnHosts(
    hosts: any[],
    executionMode: 'parallel' | 'sequential',
    includeStoppedContainers: boolean,
    config: EventConfig,
    context: EventContext
  ): Promise<any[]> {
    const results = [];

    if (executionMode === 'parallel') {
      // Execute discovery in parallel
      const promises = hosts.map(host => 
        this.discoverContainersOnSingleHost(host, includeStoppedContainers, config, context)
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
      // Execute discovery sequentially
      for (const host of hosts) {
        try {
          const result = await this.discoverContainersOnSingleHost(host, includeStoppedContainers, config, context);
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
   * Discover containers on a single host
   */
  private async discoverContainersOnSingleHost(
    host: any,
    includeStoppedContainers: boolean,
    config: EventConfig,
    context: EventContext
  ): Promise<any> {
    try {
      this.operationLogService.log('info', `Discovering containers on host ${host.name} (${host.address})`);
      
      // Use the containers service to discover containers on this host
      const result = await this.containersService.discover({ 
        id: host.id
      });
      
      return {
        success: true,
        hostId: host.id,
        hostName: host.name,
        hostAddress: host.address,
        discoveredAt: new Date(),
        includeStoppedContainers,
        message: `Container discovery completed successfully for host ${host.name}`
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Failed to discover containers on host ${host.name}: ${errorMessage}`);
      
      return {
        success: false,
        hostId: host.id,
        hostName: host.name,
        hostAddress: host.address,
        error: errorMessage
      };
    }
  }
}