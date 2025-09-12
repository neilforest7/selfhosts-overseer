import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult, DynamicConfigOptions } from '../interfaces';
import { ContainersService } from '../../../containers/containers.service';
import { HostsService } from '../../../hosts/hosts.service';

/**
 * Container state trigger plugin
 * Triggers based on container state changes (running, stopped, exited, unhealthy)
 */
@Injectable()
export class ContainerStateTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'container-state-trigger';
  public readonly name = 'Container State Trigger';
  public readonly description = 'Triggers based on container state changes';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['container', 'docker', 'state', 'monitoring'];
  public readonly triggerType = 'container-state';
  
  constructor(
    private readonly containersService: ContainersService,
    private readonly hostsService: HostsService
  ) {
    super();
  }
  
  /**
   * Evaluate container state trigger
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    try {
      if (!this.isTriggerEnabled(config)) {
        return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
      }
      
      const containerIdentifiers = this.getConfigValue(config, 'containerIdentifiers', []) as string[];
      const expectedStates = this.getConfigValue(config, 'expectedStates', ['running']) as string[];
      const triggerOn = this.getConfigValue(config, 'triggerOn', 'match') as 'match' | 'mismatch' | 'any';
      const hostIds = this.getConfigValue(config, 'hostIds', []) as string[];
      const matchMode = this.getConfigValue(config, 'matchMode', 'all') as 'all' | 'any';
      
      if (!containerIdentifiers || containerIdentifiers.length === 0) {
        return this.createTriggerResult(false, { reason: 'Container identifiers are required' });
      }
      
      if (!expectedStates || expectedStates.length === 0) {
        return this.createTriggerResult(false, { reason: 'Expected states are required' });
      }
      
      // Find all matching containers
      const matchingContainers = [];
      
      for (const identifier of containerIdentifiers) {
        const searchQuery: any = { q: identifier };
        if (hostIds.length > 0) {
          searchQuery.hostIds = hostIds;
        }
        
        const { items: containers } = await this.containersService.list(searchQuery);
        if (containers && containers.length > 0) {
          matchingContainers.push(...containers);
        }
      }
      
      if (matchingContainers.length === 0) {
        return this.createTriggerResult(false, { 
          reason: `No containers found matching identifiers: ${containerIdentifiers.join(', ')}` 
        });
      }
      
      // Evaluate state conditions
      const results = [];
      let shouldTrigger = false;
      
      for (const container of matchingContainers) {
        const currentState = this.normalizeState(container.state || 'unknown');
        const stateMatches = expectedStates.includes(currentState);
        
        let containerShouldTrigger = false;
        if (triggerOn === 'match') {
          containerShouldTrigger = stateMatches;
        } else if (triggerOn === 'mismatch') {
          containerShouldTrigger = !stateMatches;
        } else if (triggerOn === 'any') {
          containerShouldTrigger = true; // Trigger on any state change
        }
        
        results.push({
          container,
          currentState,
          stateMatches,
          shouldTrigger: containerShouldTrigger
        });
      }
      
      // Determine overall trigger based on match mode
      const matchingContainersCount = results.filter(r => r.shouldTrigger).length;
      
      if (matchMode === 'all') {
        shouldTrigger = matchingContainersCount === matchingContainers.length;
      } else { // 'any'
        shouldTrigger = matchingContainersCount > 0;
      }
      
      return this.createTriggerResult(shouldTrigger, {
        reason: shouldTrigger 
          ? `${matchingContainersCount}/${matchingContainers.length} containers match state criteria (${triggerOn} ${expectedStates.join(', ')})` 
          : `${matchingContainersCount}/${matchingContainers.length} containers match state criteria (not ${triggerOn} ${expectedStates.join(', ')})`,
        triggerData: {
          matchingContainers: matchingContainersCount,
          totalContainers: matchingContainers.length,
          expectedStates,
          triggerOn,
          matchMode,
          hostIds,
          containerResults: results.map(r => ({
            containerId: r.container.id,
            containerName: r.container.name,
            hostId: r.container.hostId,
            currentState: r.currentState,
            stateMatches: r.stateMatches,
            shouldTrigger: r.shouldTrigger,
            containerInfo: {
              status: r.container.status,
              restartCount: r.container.restartCount,
              lastStarted: r.container.startedAt
            }
          }))
        }
      });
      
    } catch (error) {
      this.logError('Error evaluating container state trigger', error);
      return this.createTriggerResult(false, { 
        reason: `Container state evaluation error: ${error instanceof Error ? error.message : String(error)}` 
      });
    }
  }
  
  /**
   * Get trigger configuration schema
   */
  public getTriggerConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        containerIdentifiers: {
          type: 'array',
          title: 'Containers to Monitor',
          description: 'Container IDs, names, or patterns to monitor (leave empty for all containers)',
          items: {
            type: 'string',
            minLength: 1,
            title: 'Container ID/Name',
            placeholder: 'nginx, web-app, or container-id'
          },
          default: [],
          examples: [['nginx'], ['web-app', 'database'], ['redis-cache', 'postgres*']]
        },
        hostIds: {
          type: 'array',
          title: 'Target Hosts',
          description: 'Limit monitoring to specific hosts (leave empty for all hosts)',
          items: {
            type: 'string',
            minLength: 1,
            title: 'Host'
          },
          default: [],
          examples: [['web-server'], ['prod-host-1', 'prod-host-2']]
        },
        expectedStates: {
          type: 'array',
          title: 'Expected Container States',
          description: 'Container states to monitor for',
          items: {
            type: 'string',
            enum: [
              'running',
              'stopped',
              'paused',
              'restarting',
              'removing',
              'dead',
              'created',
              'exited',
              'unhealthy'
            ]
          },
          default: ['running'],
          examples: [['running'], ['running', 'unhealthy'], ['stopped', 'exited']]
        },
        triggerOn: {
          type: 'string',
          title: 'Trigger Condition',
          description: 'When should this trigger activate?',
          enum: ['match', 'mismatch', 'any'],
          default: 'match',
          examples: ['match', 'mismatch', 'any']
        },
        matchMode: {
          type: 'string',
          title: 'Match Mode',
          description: 'How many containers must match the criteria to trigger',
          enum: ['all', 'any'],
          default: 'all',
          examples: ['all', 'any']
        },
        checkInterval: {
          type: 'number',
          title: 'Check Interval (seconds)',
          description: 'How often to check container state (minimum 10 seconds)',
          minimum: 10,
          maximum: 3600,
          default: 30,
          examples: [30, 60, 300]
        },
        includeHealth: {
          type: 'boolean',
          title: 'Include Health Status',
          description: 'Also monitor container health status (requires healthcheck)',
          default: false
        },
        consecutiveFailures: {
          type: 'number',
          title: 'Consecutive Failures',
          description: 'Number of consecutive state mismatches before triggering',
          minimum: 1,
          maximum: 10,
          default: 1,
          examples: [1, 2, 3]
        }
      },
      required: ['expectedStates'],
      additionalProperties: false
    };
  }
  
  /**
   * Get next evaluation time based on check interval
   */
  public async getNextEvaluationTime(config: TriggerConfig): Promise<Date | null> {
    const checkInterval = this.getConfigValue(config, 'checkInterval', 30);
    return new Date(Date.now() + (checkInterval * 1000));
  }
  
  /**
   * Validate container state trigger configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    if (!this.validateRequiredFields(config, ['expectedStates'])) {
      return false;
    }
    
    const expectedStates = this.getConfigValue(config, 'expectedStates', []);
    const validStates = [
      'running', 'stopped', 'paused', 'restarting', 
      'removing', 'dead', 'created', 'exited', 'unhealthy'
    ];
    
    if (!Array.isArray(expectedStates) || expectedStates.length === 0) {
      this.logError('expectedStates must be a non-empty array');
      return false;
    }
    
    const invalidStates = expectedStates.filter(state => !validStates.includes(state));
    if (invalidStates.length > 0) {
      this.logError(`Invalid expected states: ${invalidStates.join(', ')}`);
      return false;
    }
    
    const containerIdentifiers = this.getConfigValue(config, 'containerIdentifiers', []);
    if (Array.isArray(containerIdentifiers) && containerIdentifiers.length > 0) {
      const invalidIdentifiers = containerIdentifiers.filter(id => typeof id !== 'string' || (id as string).trim() === '');
      if (invalidIdentifiers.length > 0) {
        this.logError(`Invalid container identifiers: ${invalidIdentifiers.join(', ')}`);
        return false;
      }
    }
    
    const hostIds = this.getConfigValue(config, 'hostIds', []);
    if (Array.isArray(hostIds) && hostIds.length > 0) {
      const invalidHostIds = hostIds.filter(id => typeof id !== 'string' || (id as string).trim() === '');
      if (invalidHostIds.length > 0) {
        this.logError(`Invalid host IDs: ${invalidHostIds.join(', ')}`);
        return false;
      }
    }
    
    const triggerOn = this.getConfigValue(config, 'triggerOn', 'match');
    if (!['match', 'mismatch', 'any'].includes(triggerOn)) {
      this.logError(`Invalid triggerOn value: ${triggerOn}`);
      return false;
    }
    
    const matchMode = this.getConfigValue(config, 'matchMode', 'all');
    if (!['all', 'any'].includes(matchMode)) {
      this.logError(`Invalid matchMode value: ${matchMode}`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Get available trigger conditions
   */
  public getAvailableConditions(): Record<string, any> {
    return {
      containerStateMatch: {
        title: 'Container State Match',
        description: 'Triggered when container matches expected state',
        operators: ['equals', 'not_equals']
      },
      containerHealthy: {
        title: 'Container Health',
        description: 'Triggered based on container health status',
        operators: ['equals', 'not_equals']
      }
    };
  }

  /**
   * Get dynamic configuration options for trigger fields
   */
  public async getTriggerDynamicOptions(): Promise<DynamicConfigOptions> {
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
   * Normalize container state from Docker API
   */
  private normalizeState(state: string): string {
    if (!state) return 'unknown';
    
    const normalized = state.toLowerCase();
    
    // Map Docker states to our standardized states
    switch (normalized) {
      case 'up':
      case 'running':
        return 'running';
      case 'exited':
      case 'stopped':
        return 'stopped';
      case 'paused':
        return 'paused';
      case 'restarting':
        return 'restarting';
      case 'removing':
        return 'removing';
      case 'dead':
        return 'dead';
      case 'created':
        return 'created';
      default:
        return normalized;
    }
  }
}