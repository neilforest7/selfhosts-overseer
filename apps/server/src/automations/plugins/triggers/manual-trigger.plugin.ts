import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult } from '../interfaces';

/**
 * Manual trigger plugin
 * Allows manual triggering of automation rules
 */
@Injectable()
export class ManualTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'manual-trigger';
  public readonly name = 'Manual Trigger';
  public readonly description = 'Allows manual triggering of automation rules';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['manual', 'user-initiated'];
  public readonly triggerType = 'manual';
  
  /**
   * Evaluate manual trigger
   * Manual triggers only fire when explicitly requested
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    if (!this.isTriggerEnabled(config)) {
      return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
    }
    
    // Check if this is a manual execution request
    const isManualExecution = context.metadata?.manual === true;
    
    if (isManualExecution) {
      return this.createTriggerResult(true, {
        reason: 'Manual execution requested',
        triggerData: {
          triggeredBy: context.metadata?.triggeredBy || 'system',
          triggeredAt: context.timestamp
        }
      });
    }
    
    return this.createTriggerResult(false, { reason: 'Not a manual execution' });
  }
  
  /**
   * Manual triggers don't have scheduled evaluation times
   */
  public async getNextEvaluationTime(config: TriggerConfig): Promise<Date | null> {
    return null; // Manual triggers are always evaluated when requested
  }
  
  /**
   * Validate manual trigger configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    // Manual triggers have minimal configuration requirements
    return true;
  }
  
  /**
   * Get trigger configuration schema
   */
  public getTriggerConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        requireConfirmation: {
          type: 'boolean',
          title: 'Require Confirmation',
          description: 'Whether to require user confirmation before executing',
          default: false
        },
        allowedUsers: {
          type: 'array',
          title: 'Allowed Users',
          description: 'List of users allowed to manually trigger this rule',
          items: {
            type: 'string'
          },
          default: []
        },
        description: {
          type: 'string',
          title: 'Description',
          description: 'Description shown to users when manually triggering'
        }
      },
      additionalProperties: false
    };
  }
  
  /**
   * Get available trigger conditions
   */
  public getAvailableConditions(): Record<string, any> {
    return {
      manualExecution: {
        title: 'Manual Execution',
        description: 'Triggered when manually executed by a user',
        operators: ['equals']
      }
    };
  }
}