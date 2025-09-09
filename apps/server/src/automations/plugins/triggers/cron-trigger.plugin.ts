import { Injectable } from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult } from '../interfaces';

/**
 * CRON-based trigger plugin
 * Triggers based on time schedules using CRON expressions
 */
@Injectable()
export class CronTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'cron-trigger';
  public readonly name = 'CRON Trigger';
  public readonly description = 'Triggers automation rules based on CRON schedules';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['time', 'schedule', 'cron'];
  public readonly triggerType = 'cron';
  
  /**
   * Evaluate whether this trigger should fire based on CRON expression
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    try {
      if (!this.isTriggerEnabled(config)) {
        return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
      }
      
      const cronExpression = this.getConfigValue(config, 'expression', null);
      if (!cronExpression) {
        this.logError('CRON expression is required');
        return this.createTriggerResult(false, { reason: 'Missing CRON expression' });
      }
      
      const shouldTrigger = this.evaluateCronExpression(cronExpression, context.timestamp);
      const nextRun = this.getNextRunTime(cronExpression);
      
      return this.createTriggerResult(shouldTrigger, {
        reason: shouldTrigger ? 'CRON expression matched' : 'CRON expression did not match',
        triggerData: {
          cronExpression,
          evaluationTime: context.timestamp,
          nextRunTime: nextRun
        },
        nextEvaluationTime: nextRun || undefined
      });
      
    } catch (error) {
      this.logError('Error evaluating CRON trigger', error);
      return this.createTriggerResult(false, { 
        reason: `CRON evaluation error: ${error.message}` 
      });
    }
  }
  
  /**
   * Get the next scheduled evaluation time
   */
  public async getNextEvaluationTime(config: TriggerConfig): Promise<Date | null> {
    try {
      const cronExpression = this.getConfigValue(config, 'expression', null);
      if (!cronExpression) {
        return null;
      }
      
      return this.getNextRunTime(cronExpression);
    } catch (error) {
      this.logError('Error getting next evaluation time', error);
      return null;
    }
  }
  
  /**
   * Validate CRON trigger configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    if (!this.validateRequiredFields(config, ['expression'])) {
      return false;
    }
    
    const cronExpression = config.config.expression;
    
    try {
      // Validate CRON expression by parsing it
      CronExpressionParser.parse(cronExpression);
      return true;
    } catch (error) {
      this.logError(`Invalid CRON expression '${cronExpression}': ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get trigger configuration schema
   */
  public getTriggerConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          title: 'CRON Expression',
          description: 'CRON expression for scheduling (e.g., "0 9 * * *" for 9 AM daily)',
          pattern: '^[\\s\\d*,/-]+$',
          examples: [
            '0 9 * * *',      // 9 AM daily
            '*/5 * * * *',    // Every 5 minutes
            '0 0 * * 0',      // Weekly on Sunday
            '0 2 1 * *'       // Monthly on 1st at 2 AM
          ]
        },
        timezone: {
          type: 'string',
          title: 'Timezone',
          description: 'Timezone for CRON evaluation (defaults to system timezone)',
          default: 'UTC'
        },
        tolerance: {
          type: 'number',
          title: 'Tolerance (seconds)',
          description: 'Time tolerance for trigger matching in seconds',
          default: 60,
          minimum: 1,
          maximum: 300
        }
      },
      required: ['expression'],
      additionalProperties: false
    };
  }
  
  /**
   * Get available trigger conditions
   */
  public getAvailableConditions(): Record<string, any> {
    return {
      timeMatch: {
        title: 'Time Match',
        description: 'Matches current time against CRON expression',
        operators: ['matchesCron']
      }
    };
  }
  
  /**
   * Evaluate CRON expression against current time
   */
  private evaluateCronExpression(expression: string, currentTime: Date): boolean {
    try {
      const interval = CronExpressionParser.parse(expression);
      const prevRun = interval.prev().toDate();
      const tolerance = 60000; // 1 minute tolerance
      
      // Check if current time is within tolerance of the scheduled time
      const timeDiff = Math.abs(currentTime.getTime() - prevRun.getTime());
      const matches = timeDiff < tolerance;
      
      this.logDebug(
        `CRON evaluation: expression="${expression}", ` +
        `now=${currentTime.toISOString()}, ` +
        `prevRun=${prevRun.toISOString()}, ` +
        `timeDiff=${timeDiff}ms, ` +
        `matches=${matches}`
      );
      
      return matches;
    } catch (error) {
      this.logError(`CRON evaluation error: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get next run time for CRON expression
   */
  private getNextRunTime(expression: string): Date | null {
    try {
      const interval = CronExpressionParser.parse(expression);
      return interval.next().toDate();
    } catch (error) {
      this.logError(`Error getting next run time: ${error.message}`);
      return null;
    }
  }
}