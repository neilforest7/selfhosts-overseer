import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AutomationsService } from './automations.service';

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



    // Create the automation rule using the new normalized format
    const rule = await this.automationsService.create({
      name: config.name,
      description: config.description || `Automated container update schedule: ${config.name}`,
      isEnabled: config.enabled !== false,
      triggers: [{
        type: 'cron-trigger',
        name: 'Schedule Trigger',
        pluginId: 'cron-trigger-plugin',
        pluginVersion: '1.0.0',
        config: {
          cronExpression: config.cronExpression || '0 2 * * *', // Default to 2 AM daily
          timezone: 'UTC'
        }
      }],
      events: [{
        type: 'container-update-event',
        name: 'Update Containers',
        pluginId: 'container-update-plugin',
        pluginVersion: '1.0.0',
        params: {
          hostIds: config.hostIds || [],
          containerIds: config.containerIds || [],
          composeProjects: config.composeProjects || [],
          updateOptions: config.updateOptions || {}
        }
      }]
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


    const rule = await this.automationsService.create({
      name: config.name,
      description: `Automated container update check: ${config.name}`,
      isEnabled: config.enabled !== false,
      triggers: [{
        type: 'cron-trigger',
        name: 'Schedule Trigger',
        pluginId: 'cron-trigger-plugin',
        pluginVersion: '1.0.0',
        config: {
          cronExpression: config.cronExpression,
          timezone: 'UTC'
        }
      }],
      events: [{
        type: 'check-container-updates-event',
        name: 'Check Container Updates',
        pluginId: 'check-container-updates-plugin',
        pluginVersion: '1.0.0',
        params: {
          hostIds: config.hostIds
        }
      }]
    });

    this.logger.log(`Created update check schedule with rule ID: ${rule.id}`);
    return rule.id;
  }



  /**
   * List all container update automation rules
   */
  async listUpdateSchedules(): Promise<any[]> {
    const rules = await this.automationsService.findAll();

    // Filter rules that are related to container updates by checking events
    return rules.filter(rule => {
      const hasContainerUpdateEvents = rule.events?.some(event =>
        [
          'check-container-updates',
          'check-container-updates-event',
          'update-container',
          'container-update-event',
          'batch-update-containers',
          'update-compose-project',
        ].includes(event.type)
      );
      return hasContainerUpdateEvents || rule.category === 'container-updates';
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
  async getUpcomingUpdates(): Promise<any[]> {
    const schedules = await this.listUpdateSchedules();
    const upcoming: any[] = [];

    for (const schedule of schedules) {
      if (!schedule.isEnabled) continue;

      // Extract CRON expression from triggers
      const cronTrigger = schedule.triggers?.find((trigger: any) => trigger.type === 'cron-trigger');
      const cronExpression = cronTrigger?.config?.cronExpression;

      if (cronExpression) {
        // Get the first event for event type and params
        const firstEvent = schedule.events?.[0];

        upcoming.push({
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          cronExpression,
          eventType: firstEvent?.type,
          params: firstEvent?.params,
        });
      }
    }

    return upcoming;
  }


}
