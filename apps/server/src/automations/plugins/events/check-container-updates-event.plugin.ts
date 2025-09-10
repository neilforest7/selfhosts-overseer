import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult, DynamicConfigOptions } from '../interfaces';
import { ContainersService } from '../../../containers/containers.service';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { HostsService } from '../../../hosts/hosts.service';

/**
 * Check container updates event plugin
 * Checks for available updates for containers
 */
@Injectable()
export class CheckContainerUpdatesEventPlugin extends BaseEventPlugin {
  public readonly id = 'check-container-updates-event';
  public readonly name = 'Check Container Updates';
  public readonly description = 'Checks for available updates for containers';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['docker', 'container', 'updates', 'check'];
  public readonly eventType = 'check-container-updates';
  
  constructor(
    private readonly containersService: ContainersService,
    private readonly operationLogService: OperationLogService,
    private readonly hostsService: HostsService
  ) {
    super();
  }
  
  /**
   * Execute the check container updates event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const hostIds = this.getParam(config, 'hostIds', []);
      const containerIds = this.getParam(config, 'containerIds', []);
      const composeProjects = this.getParam(config, 'composeProjects', []);
      const skipCritical = this.getParam(config, 'skipCritical', false);
      const onlyOutdated = this.getParam(config, 'onlyOutdated', false);
      
      this.operationLogService.log('info', 'Starting container update check automation');
      
      return await this.executeWithRetry(async () => {
        const result = await this.containersService.batchCheckUpdates({
          hostIds: hostIds.length > 0 ? hostIds : undefined,
          containerIds: containerIds.length > 0 ? containerIds : undefined,
          composeProjects: composeProjects.length > 0 ? composeProjects : undefined,
          skipCritical,
          onlyOutdated,
        });
        
        const successMessage = `Container update check completed. Task ID: ${result.taskId}`;
        this.operationLogService.log('info', successMessage);
        
        return this.createSuccessResult(
          successMessage,
          {
            taskId: result.taskId,
            hostIds,
            containerIds,
            composeProjects,
            skipCritical,
            onlyOutdated,
            checkedAt: new Date()
          }
        );
      }, config, context);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to check container updates', error);
      this.operationLogService.log('error', `Container update check failed: ${errorMessage}`);
      return this.createFailureResult(`Container update check failed: ${errorMessage}`);
    }
  }
  
  /**
   * Validate check container updates configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    // At least one of hostIds, containerIds, or composeProjects should be specified
    const hostIds = config.params.hostIds;
    const containerIds = config.params.containerIds;
    const composeProjects = config.params.composeProjects;
    
    if ((!hostIds || hostIds.length === 0) && 
        (!containerIds || containerIds.length === 0) && 
        (!composeProjects || composeProjects.length === 0)) {
      this.logError('At least one of hostIds, containerIds, or composeProjects must be specified');
      return false;
    }
    
    // Validate array types
    if (hostIds && !Array.isArray(hostIds)) {
      this.logError('hostIds must be an array');
      return false;
    }
    
    if (containerIds && !Array.isArray(containerIds)) {
      this.logError('containerIds must be an array');
      return false;
    }
    
    if (composeProjects && !Array.isArray(composeProjects)) {
      this.logError('composeProjects must be an array');
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
          const: 'check-container-updates'
        },
        params: {
          $ref: '#/definitions/CheckContainerUpdatesParams'
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
              minimum: 30000,
              maximum: 600000,
              default: 120000
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
        CheckContainerUpdatesParams: {
          type: 'object',
          properties: {
            hostIds: {
              type: 'array',
              title: 'Target Hosts',
              description: 'Hosts to check for container updates (empty = all hosts)',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Host',
                placeholder: 'Select hosts'
              },
              default: [],
              examples: [
                ['web-server', 'api-server'],
                ['prod-host-1', 'prod-host-2', 'prod-host-3']
              ]
            },
            containerIds: {
              type: 'array',
              title: 'Specific Containers',
              description: 'Specific containers to check (empty = all containers)',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Container',
                placeholder: 'Container name or ID'
              },
              default: [],
              examples: [
                ['nginx', 'redis', 'postgres'],
                ['web-app-prod', 'api-service']
              ]
            },
            composeProjects: {
              type: 'array',
              title: 'Compose Projects',
              description: 'Docker Compose projects to check for updates',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Project Name',
                placeholder: 'Compose project name'
              },
              default: [],
              examples: [
                ['webapp', 'monitoring'],
                ['production-stack', 'logging-stack']
              ]
            },
            updateStrategy: {
              type: 'string',
              title: 'Update Strategy',
              description: 'How to handle available updates',
              enum: ['check-only', 'notify', 'auto-update', 'schedule'],
              default: 'check-only',
              examples: ['check-only', 'notify', 'auto-update']
            },
            skipCritical: {
              type: 'boolean',
              title: 'Skip Critical Containers',
              description: 'Skip containers marked as critical during update check',
              default: false
            },
            onlyOutdated: {
              type: 'boolean',
              title: 'Only Check Outdated',
              description: 'Only check containers that are already known to be outdated',
              default: false
            },
            includePrerelease: {
              type: 'boolean',
              title: 'Include Prerelease',
              description: 'Include prerelease/beta versions in update check',
              default: false
            }
          },
          additionalProperties: false
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
          title: 'Host IDs',
          description: 'List of host IDs to check for updates',
          items: {
            type: 'string',
            minLength: 1
          },
          default: []
        },
        containerIds: {
          type: 'array',
          title: 'Container IDs',
          description: 'List of specific container IDs to check',
          items: {
            type: 'string',
            minLength: 1
          },
          default: []
        },
        composeProjects: {
          type: 'array',
          title: 'Compose Projects',
          description: 'List of compose project names to check',
          items: {
            type: 'string',
            minLength: 1
          },
          default: []
        },
        skipCritical: {
          type: 'boolean',
          title: 'Skip Critical',
          description: 'Skip critical containers during update check',
          default: false
        },
        onlyOutdated: {
          type: 'boolean',
          title: 'Only Outdated',
          description: 'Only check containers that are already known to be outdated',
          default: false
        }
      },
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
   * Update checks can take significant time depending on scope
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const hostIds = this.getParam(config, 'hostIds', []);
    const containerIds = this.getParam(config, 'containerIds', []);
    const composeProjects = this.getParam(config, 'composeProjects', []);
    
    // Estimate based on scope
    const hostCount = hostIds.length;
    const containerCount = containerIds.length;
    const projectCount = composeProjects.length;
    
    // Base time + time per host/container/project
    return Math.max(30000, (hostCount * 20000) + (containerCount * 5000) + (projectCount * 10000));
  }
  
  /**
   * Update checks require network access and may need elevated privileges
   */
  public requiresElevatedPrivileges(config: EventConfig): boolean {
    return true; // Requires SSH access and Docker registry access
  }
}