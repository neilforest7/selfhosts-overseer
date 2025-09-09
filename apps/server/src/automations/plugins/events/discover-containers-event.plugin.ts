import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';
import { ContainersService } from '../../../containers/containers.service';
import { OperationLogService } from '../../../operation-log/operation-log.service';

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
    private readonly operationLogService: OperationLogService
  ) {
    super();
  }
  
  /**
   * Execute the discover containers event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const hostId = this.getParam(config, 'hostId', null);
      const hostIds = this.getParam(config, 'hostIds', []);
      const includeStoppedContainers = this.getParam(config, 'includeStoppedContainers', true);
      const refreshMetadata = this.getParam(config, 'refreshMetadata', true);
      
      // Support both single host (legacy) and multiple hosts (new)
      if (hostIds && hostIds.length > 0) {
        // Multiple hosts
        this.operationLogService.log('info', `Starting container discovery for ${hostIds.length} hosts: ${hostIds.join(', ')}`);
        
        return await this.executeWithRetry(async () => {
          await this.containersService.discoverMultiple(hostIds, {
            includeStoppedContainers,
            refreshMetadata
          });
          
          const successMessage = `Container discovery completed successfully for ${hostIds.length} hosts`;
          this.operationLogService.log('info', successMessage);
          
          return this.createSuccessResult(
            successMessage,
            {
              hostIds,
              discoveredAt: new Date(),
              includeStoppedContainers,
              refreshMetadata
            }
          );
        }, config, context);
        
      } else if (hostId) {
        // Single host (legacy support)
        this.operationLogService.log('info', `Starting container discovery for host: ${hostId}`);
        
        return await this.executeWithRetry(async () => {
          await this.containersService.discover({ id: hostId }, {
            includeStoppedContainers,
            refreshMetadata
          });
          
          const successMessage = `Container discovery completed successfully for host: ${hostId}`;
          this.operationLogService.log('info', successMessage);
          
          return this.createSuccessResult(
            successMessage,
            {
              hostId,
              discoveredAt: new Date(),
              includeStoppedContainers,
              refreshMetadata
            }
          );
        }, config, context);
        
      } else {
        const error = 'Either hostId or hostIds is required for discover-containers event';
        this.operationLogService.log('error', error);
        return this.createFailureResult(error);
      }
      
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
    const hostId = config.params.hostId;
    const hostIds = config.params.hostIds;
    
    if (!hostId && (!hostIds || !Array.isArray(hostIds) || hostIds.length === 0)) {
      this.logError('Either hostId or hostIds (non-empty array) is required');
      return false;
    }
    
    if (hostId && hostIds) {
      this.logError('Cannot specify both hostId and hostIds');
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
            hostId: {
              type: 'string',
              title: 'Host ID',
              description: 'Single host ID for discovery (legacy)',
              minLength: 1
            },
            hostIds: {
              type: 'array',
              title: 'Host IDs',
              description: 'List of host IDs for discovery',
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
            refreshMetadata: {
              type: 'boolean',
              title: 'Refresh Metadata',
              description: 'Whether to refresh container metadata during discovery',
              default: true
            }
          },
          anyOf: [
            { required: ['hostId'] },
            { required: ['hostIds'] }
          ]
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
        hostId: {
          type: 'string',
          title: 'Host ID',
          description: 'Single host ID for discovery',
          minLength: 1
        },
        hostIds: {
          type: 'array',
          title: 'Host IDs',
          description: 'List of host IDs for discovery',
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
        refreshMetadata: {
          type: 'boolean',
          title: 'Refresh Metadata',
          description: 'Whether to refresh container metadata during discovery',
          default: true
        }
      },
      anyOf: [
        { required: ['hostId'] },
        { required: ['hostIds'] }
      ],
      additionalProperties: false
    };
  }
  
  /**
   * Discovery typically takes 30-120 seconds depending on host count
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const hostIds = this.getParam(config, 'hostIds', []);
    const hostId = this.getParam(config, 'hostId', null);
    const hostCount = hostIds.length || (hostId ? 1 : 0);
    
    return Math.max(30000, hostCount * 15000); // 15 seconds per host, minimum 30 seconds
  }
  
  /**
   * Container discovery requires SSH access to hosts
   */
  public requiresElevatedPrivileges(config: EventConfig): boolean {
    return true; // Requires SSH access to hosts
  }
}