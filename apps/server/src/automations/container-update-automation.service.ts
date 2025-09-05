import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationsService } from './automations.service';
import { Prisma } from '@prisma/client';

export interface ContainerUpdateScheduleConfig {
  name: string;
  description?: string;
  enabled?: boolean;
  cronExpression: string;
  hostIds?: string[];
  containerIds?: string[];
  composeProjects?: string[];
  updateOptions?: {
    skipValidation?: boolean;
    skipCritical?: boolean;
    maxConcurrent?: number;
    rollbackOnFailure?: boolean;
    updateStrategy?: 'sequential' | 'parallel' | 'rolling';
    delayBetweenUpdates?: number;
    onlyCompose?: boolean;
    onlyCli?: boolean;
  };
  maintenanceWindow?: {
    start: string; // HH:MM format
    end: string;   // HH:MM format
    days: number[]; // 0-6, Sunday=0
    timezone?: string;
  };
  notificationSettings?: {
    onSuccess?: boolean;
    onFailure?: boolean;
    webhookUrl?: string;
    emailRecipients?: string[];
  };
}

@Injectable()
export class ContainerUpdateAutomationService {
  private readonly logger = new Logger(ContainerUpdateAutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly automationsService: AutomationsService,
  ) {}

  /**
   * Create a container update schedule using automation rules
   */
  async createUpdateSchedule(config: ContainerUpdateScheduleConfig): Promise<string> {
    this.logger.log(`Creating container update schedule: ${config.name}`);

    // Build the automation rule JSON
    const ruleJson = this.buildUpdateScheduleRule(config);

    // Create the automation rule
    const rule = await this.automationsService.create({
      name: config.name,
      description: config.description || `Automated container update schedule: ${config.name}`,
      isEnabled: config.enabled !== false,
      ruleJson: ruleJson as any,
    });

    this.logger.log(`Created container update schedule with rule ID: ${rule.id}`);
    return rule.id;
  }

  /**
   * Create a simple daily update check schedule
   */
  async createDailyUpdateCheck(config: {
    name: string;
    hour: number;
    minute: number;
    hostIds?: string[];
    enabled?: boolean;
  }): Promise<string> {
    const cronExpression = `${config.minute} ${config.hour} * * *`;
    
    return this.createUpdateSchedule({
      name: config.name,
      description: `Daily container update check at ${config.hour.toString().padStart(2, '0')}:${config.minute.toString().padStart(2, '0')}`,
      enabled: config.enabled !== false,
      cronExpression,
      hostIds: config.hostIds,
      updateOptions: {
        skipValidation: false,
        rollbackOnFailure: true,
        updateStrategy: 'sequential',
        maxConcurrent: 1,
      },
    });
  }

  /**
   * Create a weekly maintenance window update schedule
   */
  async createWeeklyMaintenanceUpdate(config: {
    name: string;
    dayOfWeek: number; // 0 = Sunday, 1 = Monday, etc.
    hour: number;
    minute: number;
    hostIds?: string[];
    composeProjects?: string[];
    enabled?: boolean;
  }): Promise<string> {
    const cronExpression = `${config.minute} ${config.hour} * * ${config.dayOfWeek}`;
    
    return this.createUpdateSchedule({
      name: config.name,
      description: `Weekly container update on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][config.dayOfWeek]} at ${config.hour.toString().padStart(2, '0')}:${config.minute.toString().padStart(2, '0')}`,
      enabled: config.enabled !== false,
      cronExpression,
      hostIds: config.hostIds,
      composeProjects: config.composeProjects,
      updateOptions: {
        skipValidation: false,
        rollbackOnFailure: true,
        updateStrategy: 'sequential',
        maxConcurrent: 2,
      },
    });
  }

  /**
   * Create an update check only schedule (no automatic updates)
   */
  async createUpdateCheckSchedule(config: {
    name: string;
    cronExpression: string;
    hostIds?: string[];
    enabled?: boolean;
  }): Promise<string> {
    const ruleJson = {
      conditions: {
        all: [
          {
            fact: 'time',
            operator: 'matchesCron',
            value: config.cronExpression,
          },
        ],
      },
      event: {
        type: 'check-container-updates',
        params: {
          hostIds: config.hostIds,
        },
      },
    };

    const rule = await this.automationsService.create({
      name: config.name,
      description: `Automated container update check: ${config.name}`,
      isEnabled: config.enabled !== false,
      ruleJson: ruleJson as any,
    });

    this.logger.log(`Created update check schedule with rule ID: ${rule.id}`);
    return rule.id;
  }

  /**
   * Build automation rule JSON for container update schedule
   */
  private buildUpdateScheduleRule(config: ContainerUpdateScheduleConfig): any {
    const conditions: any = {
      all: [
        {
          fact: 'time',
          operator: 'matchesCron',
          value: config.cronExpression,
        },
      ],
    };

    // Add maintenance window conditions if specified
    if (config.maintenanceWindow) {
      const { start, end, days } = config.maintenanceWindow;
      const [startHour, startMinute] = start.split(':').map(Number);
      const [endHour, endMinute] = end.split(':').map(Number);

      // Add day of week condition
      if (days && days.length > 0) {
        conditions.all.push({
          fact: 'time',
          path: '$.dayOfWeek',
          operator: 'in',
          value: days,
        });
      }

      // Add time range condition
      conditions.all.push({
        any: [
          {
            all: [
              {
                fact: 'time',
                path: '$.hour',
                operator: 'greaterThanInclusive',
                value: startHour,
              },
              {
                fact: 'time',
                path: '$.hour',
                operator: 'lessThanInclusive',
                value: endHour,
              },
            ],
          },
        ],
      });
    }

    // Determine the event type based on configuration
    let eventType = 'batch-update-containers';
    if (config.composeProjects && config.composeProjects.length > 0 && !config.containerIds) {
      eventType = 'batch-update-containers'; // Still use batch update for compose projects
    }

    const eventParams: any = {
      hostIds: config.hostIds,
      containerIds: config.containerIds,
      composeProjects: config.composeProjects,
      ...config.updateOptions,
    };

    return {
      conditions,
      event: {
        type: eventType,
        params: eventParams,
      },
    };
  }

  /**
   * List all container update automation rules
   */
  async listUpdateSchedules(): Promise<any[]> {
    const rules = await this.automationsService.findAll();
    
    // Filter rules that are related to container updates
    return rules.filter(rule => {
      const ruleJson = rule.ruleJson as any;
      const eventType = ruleJson?.event?.type;
      return [
        'check-container-updates',
        'update-container',
        'batch-update-containers',
        'update-compose-project',
      ].includes(eventType);
    });
  }

  /**
   * Delete a container update schedule
   */
  async deleteUpdateSchedule(ruleId: string): Promise<void> {
    await this.automationsService.remove(ruleId);
    this.logger.log(`Deleted container update schedule: ${ruleId}`);
  }

  /**
   * Enable/disable a container update schedule
   */
  async toggleUpdateSchedule(ruleId: string, enabled: boolean): Promise<void> {
    await this.automationsService.update(ruleId, { isEnabled: enabled });
    this.logger.log(`${enabled ? 'Enabled' : 'Disabled'} container update schedule: ${ruleId}`);
  }

  /**
   * Get upcoming scheduled updates for the next N hours
   */
  async getUpcomingUpdates(hours: number = 24): Promise<any[]> {
    const schedules = await this.listUpdateSchedules();
    const upcoming: any[] = [];

    for (const schedule of schedules) {
      if (!schedule.isEnabled) continue;

      const ruleJson = schedule.ruleJson as any;
      const cronExpression = this.extractCronFromRule(ruleJson);
      
      if (cronExpression) {
        // Calculate next run times (this would need a proper CRON parser)
        // For now, just return the schedule info
        upcoming.push({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          cronExpression,
          eventType: ruleJson.event?.type,
          params: ruleJson.event?.params,
        });
      }
    }

    return upcoming;
  }

  private extractCronFromRule(ruleJson: any): string | null {
    const conditions = ruleJson?.conditions;
    if (!conditions) return null;

    // Look for CRON condition in the rule
    const findCronCondition = (obj: any): string | null => {
      if (obj.operator === 'matchesCron') {
        return obj.value;
      }
      if (obj.all) {
        for (const condition of obj.all) {
          const result = findCronCondition(condition);
          if (result) return result;
        }
      }
      if (obj.any) {
        for (const condition of obj.any) {
          const result = findCronCondition(condition);
          if (result) return result;
        }
      }
      return null;
    };

    return findCronCondition(conditions);
  }
}
