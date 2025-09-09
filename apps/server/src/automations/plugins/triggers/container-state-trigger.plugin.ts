import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult } from '../interfaces';
import { ContainersService } from '../../../containers/containers.service';

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
    private readonly containersService: ContainersService
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
      
      const containerIdentifier = this.getConfigValue(config, 'containerIdentifier', '');
      const expectedState = this.getConfigValue(config, 'expectedState', 'running');
      const triggerOn = this.getConfigValue(config, 'triggerOn', 'match'); // 'match' or 'mismatch'
      const hostId = this.getConfigValue(config, 'hostId', null);
      
      if (!containerIdentifier) {
        return this.createTriggerResult(false, { reason: 'Container identifier is required' });
      }
      
      // Find container
      const searchQuery: any = { q: containerIdentifier };
      if (hostId) {
        searchQuery.hostId = hostId;
      }
      
      const { items: containers } = await this.containersService.list(searchQuery);
      if (!containers || containers.length === 0) {
        return this.createTriggerResult(false, { 
          reason: `Container '${containerIdentifier}' not found` 
        });
      }
      
      const container = containers[0];
      const currentState = this.normalizeState(container.state);
      
      const stateMatches = currentState === expectedState;
      const shouldTrigger = (triggerOn === 'match' && stateMatches) || 
                           (triggerOn === 'mismatch' && !stateMatches);
      
      return this.createTriggerResult(shouldTrigger, {
        reason: shouldTrigger 
          ? `Container ${container.name} is ${currentState} (${triggerOn} ${expectedState})` 
          : `Container ${container.name} is ${currentState} (not ${triggerOn} ${expectedState})`,
        triggerData: {
          containerId: container.id,
          containerName: container.name,
          hostId: container.hostId,
          currentState,
          expectedState,
          triggerOn,
          containerInfo: {
            status: container.status,
            restartCount: container.restartCount,
            lastStarted: container.startedAt
          }
        }
      });
      
    } catch (error) {
      this.logError('Error evaluating container state trigger', error);
      return this.createTriggerResult(false, { 
        reason: `Container state evaluation error: ${error.message}` 
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
        containerIdentifier: {
          type: 'string',
          title: 'Container ID/Name',
          description: 'Container ID, name, or partial match',
          minLength: 1
        },
        hostId: {
          type: 'string',
          title: 'Host ID (Optional)',
          description: 'Limit search to specific host'
        },
        expectedState: {
          type: 'string',
          title: 'Expected State',
          description: 'Container state to check for',
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
          ],
          default: 'running'
        },
        triggerOn: {
          type: 'string',
          title: 'Trigger Condition',
          description: 'When to trigger the rule',
          enum: ['match', 'mismatch'],
          default: 'match'
        },
        checkInterval: {
          type: 'number',
          title: 'Check Interval (seconds)',
          description: 'How often to check container state',
          minimum: 10,
          maximum: 3600,
          default: 30
        },
        includeHealth: {
          type: 'boolean',
          title: 'Include Health Status',
          description: 'Also consider container health status',
          default: false
        }
      },
      required: ['containerIdentifier', 'expectedState'],
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
    if (!this.validateRequiredFields(config, ['containerIdentifier', 'expectedState'])) {
      return false;
    }
    
    const expectedState = config.config.expectedState;
    const validStates = [
      'running', 'stopped', 'paused', 'restarting', 
      'removing', 'dead', 'created', 'exited', 'unhealthy'
    ];
    
    if (!validStates.includes(expectedState)) {
      this.logError(`Invalid expected state: ${expectedState}`);
      return false;
    }
    
    const triggerOn = config.config.triggerOn;
    if (triggerOn && !['match', 'mismatch'].includes(triggerOn)) {
      this.logError(`Invalid triggerOn value: ${triggerOn}`);
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