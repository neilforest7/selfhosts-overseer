import { Injectable, BadRequestException, NotFoundException, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TriggerType, AutomationRule, RuleTrigger, RuleEvent, RuleNotification } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AUTOMATION_QUEUE_NAME } from './plugins/processors/plugin-automations.processor';
import { TestAutomationRuleDto } from './dto/test-automation-rule.dto';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';
import { UpdateValidator } from './validators/update-validator';
import { AuditLogService } from './services/audit-log.service';
import { PluginRegistry } from './plugins/registry/plugin-registry.service';

// Enhanced types for the new normalized schema
export interface CreateAutomationRuleDto {
  name: string;
  description?: string;
  isEnabled?: boolean;
  priority?: number;
  category?: string;
  tags?: string[];
  templateId?: string;
  parentRuleId?: string;
  triggers: CreateTriggerDto[];
  events: CreateEventDto[];
  notifications?: CreateNotificationDto[];
}

export interface CreateTriggerDto {
  type: string;
  name?: string;
  description?: string;
  isEnabled?: boolean;
  priority?: number;
  pluginId: string;
  pluginVersion: string;
  config: Record<string, any>;
  conditions?: Record<string, any>;
}

export interface CreateEventDto {
  type: string;
  name?: string;
  description?: string;
  isEnabled?: boolean;
  priority?: number;
  pluginId: string;
  pluginVersion: string;
  params: Record<string, any>;
  options?: Record<string, any>;
}

export interface CreateNotificationDto {
  name?: string;
  description?: string;
  isEnabled?: boolean;
  notifyOn: ('SUCCESS' | 'FAILURE' | 'ALWAYS' | 'WARNING')[];
  channels: Array<{
    type: string;
    config: Record<string, any>;
    isEnabled?: boolean;
  }>;
  templateId?: string;
}

export interface AutomationRuleWithRelations extends AutomationRule {
  triggers: RuleTrigger[];
  events: RuleEvent[];
  notifications: RuleNotification[];
  template?: any;
  parentRule?: AutomationRule;
  childRules?: AutomationRule[];
  _count?: {
    operations: number;
    executions: number;
  };
  errorCount?: number;
}

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(AUTOMATION_QUEUE_NAME) private readonly automationsQueue: Queue,
    private operationLogService: OperationLogService,
    private contextService: ContextService,
    private updateValidator: UpdateValidator,
    private auditLogService: AuditLogService,
    private pluginRegistry: PluginRegistry,
  ) {}

  /**
   * Create a new automation rule with normalized schema
   */
  async create(data: CreateAutomationRuleDto): Promise<AutomationRuleWithRelations> {
    const rule = await this.prisma.automationRule.create({
      data: {
        name: data.name,
        description: data.description,
        isEnabled: data.isEnabled ?? true,
        priority: data.priority ?? 0,
        category: data.category,
        tags: data.tags || [],
        templateId: data.templateId,
        parentRuleId: data.parentRuleId,
        version: '1.0.0',
        triggers: {
          create: data.triggers.map(trigger => ({
            type: trigger.type,
            name: trigger.name || `${data.name} - ${trigger.type}`,
            description: trigger.description,
            isEnabled: trigger.isEnabled ?? true,
            priority: trigger.priority ?? 0,
            pluginId: trigger.pluginId,
            pluginVersion: trigger.pluginVersion,
            config: trigger.config,
            conditions: trigger.conditions
          }))
        },
        events: {
          create: data.events.map(event => ({
            type: event.type,
            name: event.name || `${data.name} - ${event.type}`,
            description: event.description,
            isEnabled: event.isEnabled ?? true,
            priority: event.priority ?? 0,
            pluginId: event.pluginId,
            pluginVersion: event.pluginVersion,
            params: event.params,
            options: event.options
          }))
        },
        notifications: data.notifications ? {
          create: data.notifications.map(notification => ({
            name: notification.name || `${data.name} - notification`,
            description: notification.description,
            isEnabled: notification.isEnabled ?? true,
            notifyOn: notification.notifyOn as any, // Cast to handle enum conversion
            templateId: notification.templateId,
            channels: {
              create: notification.channels.map(channel => ({
                type: channel.type,
                config: channel.config,
                isEnabled: channel.isEnabled ?? true
              }))
            }
          }))
        } : undefined
      },
      include: {
        triggers: true,
        events: true,
        notifications: {
          include: {
            channels: true
          }
        },
        template: true,
        parentRule: true,
        childRules: true
      }
    });

    return rule as AutomationRuleWithRelations;
  }



  /**
   * Find all automation rules with enhanced relations
   */
  async findAll(): Promise<AutomationRuleWithRelations[]> {
    const rules = await this.prisma.automationRule.findMany({
      include: {
        triggers: {
          include: {
            plugin: true
          }
        },
        events: {
          include: {
            plugin: true
          }
        },
        notifications: {
          include: {
            channels: true,
            template: true
          }
        },
        template: true,
        parentRule: true,
        childRules: true,
        _count: {
          select: {
            operations: true,
            executions: true,
          },
        },
      },
      orderBy: [
        { priority: 'desc' },
        { updatedAt: 'desc' }
      ],
    });

    // Manually count errors for each rule
    const rulesWithCounts = await Promise.all(
      rules.map(async (rule) => {
        const errorCount = await this.prisma.operationLog.count({
          where: {
            automationRuleId: rule.id,
            status: 'ERROR',
          },
        });
        return {
          ...rule,
          errorCount,
        };
      }),
    );

    return rulesWithCounts as AutomationRuleWithRelations[];
  }

  /**
   * Find a single automation rule with all relations
   */
  async findOne(id: string): Promise<AutomationRuleWithRelations | null> {
    return this.prisma.automationRule.findUnique({
      where: { id },
      include: {
        triggers: {
          include: {
            plugin: true,
            executions: {
              take: 10,
              orderBy: { executedAt: 'desc' }
            }
          }
        },
        events: {
          include: {
            plugin: true,
            executions: {
              take: 10,
              orderBy: { executedAt: 'desc' }
            }
          }
        },
        notifications: {
          include: {
            channels: true,
            template: true
          }
        },
        template: true,
        parentRule: true,
        childRules: true,
        dependencies: {
          include: {
            requiredRule: true
          }
        },
        dependents: {
          include: {
            dependentRule: true
          }
        },
        executions: {
          take: 20,
          orderBy: { startedAt: 'desc' },
          include: {
            triggerResults: true,
            eventResults: true
          }
        },
        metrics: {
          take: 30,
          orderBy: { date: 'desc' }
        }
      }
    }) as Promise<AutomationRuleWithRelations | null>;
  }

  /**
   * Update an automation rule with full nested relationship support
   */
  async update(id: string, data: any): Promise<AutomationRuleWithRelations> {
    const startTime = Date.now();
    this.logger.log(`Starting update for rule ${id}`);

    let beforeSnapshot: any = null;
    let afterSnapshot: any = null;

    try {
      // 1. Pre-validation
      await this.validateUpdateData(id, data);

      // 2. Get current state for audit log
      beforeSnapshot = await this.prisma.automationRule.findUnique({
        where: { id },
        include: {
          triggers: true,
          events: true,
          notifications: {
            include: {
              channels: true
            }
          }
        }
      });

      if (!beforeSnapshot) {
        throw new NotFoundException(`Automation rule with id ${id} not found`);
      }

      // 3. Use transaction to ensure data consistency
      const result = await this.prisma.$transaction(async (tx) => {
        // 3.1. Update basic fields
        await tx.automationRule.update({
          where: { id },
          data: {
            name: data.name,
            description: data.description,
            isEnabled: data.isEnabled,
            priority: data.priority,
            category: data.category,
            tags: data.tags,
            updatedAt: new Date()
          }
        });

        // 3.2. Update triggers if provided
        if (data.triggers !== undefined) {
          await this.updateTriggers(tx, id, data.triggers, data.name || beforeSnapshot.name);
        }

        // 3.3. Update events if provided
        if (data.events !== undefined) {
          await this.updateEvents(tx, id, data.events, data.name || beforeSnapshot.name);
        }

        // 3.4. Update notifications if provided
        if (data.notifications !== undefined) {
          await this.updateNotifications(tx, id, data.notifications, data.name || beforeSnapshot.name);
        }

        // 3.5. Return updated rule with all relations
        return await tx.automationRule.findUnique({
          where: { id },
          include: {
            triggers: {
              include: {
                plugin: true
              }
            },
            events: {
              include: {
                plugin: true
              }
            },
            notifications: {
              include: {
                channels: true,
                template: true
              }
            },
            template: true,
            parentRule: true,
            childRules: true
          }
        });
      }, {
        timeout: 30000, // 30 second timeout
        maxWait: 5000,  // Wait up to 5 seconds to start the transaction
      });

      // 4. Get after snapshot for audit log
      afterSnapshot = result;

      // 5. Clean up any old BullMQ jobs that might exist from previous implementation
      const job = await this.automationsQueue.getJob(id);
      if (job) {
        await job.remove();
      }

      const duration = Date.now() - startTime;
      this.logger.log(`✅ Rule update completed in ${duration}ms for rule ${id}`);

      // 6. Create audit log entry
      await this.createAuditLogEntry(id, beforeSnapshot, afterSnapshot, data, duration, true);

      return result as AutomationRuleWithRelations;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`❌ Rule update failed after ${duration}ms for rule ${id}:`, error);

      // Create audit log entry for failed operation
      if (beforeSnapshot) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        await this.createAuditLogEntry(id, beforeSnapshot, null, data, duration, false, errorMsg);
      }

      // Re-throw with appropriate HTTP status
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      // Handle Prisma errors
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new BadRequestException(`Rule name already exists: ${data.name}`);
        }
        if (error.code === 'P2025') {
          throw new NotFoundException(`Rule with id ${id} not found`);
        }
        throw new BadRequestException(`Database error: ${error.message}`);
      }

      // Handle unknown errors
      this.logger.error(`Unexpected error during rule update:`, error);
      throw new InternalServerErrorException('Failed to update automation rule');
    }
  }



  /**
   * Delete an automation rule and all related data
   */
  async remove(id: string): Promise<AutomationRule> {
    // Clean up BullMQ jobs
    const job = await this.automationsQueue.getJob(id);
    if (job) {
      await job.remove();
    }

    // Delete the rule (cascading deletes will handle related data)
    return this.prisma.automationRule.delete({ where: { id } });
  }

  /**
   * Find all enabled automation rules for execution
   */
  async findAllEnabledRules(): Promise<AutomationRuleWithRelations[]> {
    return this.prisma.automationRule.findMany({
      where: { isEnabled: true },
      include: {
        triggers: {
          where: { isEnabled: true },
          include: {
            plugin: true
          }
        },
        events: {
          where: { isEnabled: true },
          include: {
            plugin: true
          }
        },
        notifications: {
          where: { isEnabled: true },
          include: {
            channels: {
              where: { isEnabled: true }
            }
          }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { updatedAt: 'desc' }
      ]
    }) as Promise<AutomationRuleWithRelations[]>;
  }

  /**
   * Test an automation rule with custom facts
   */
  async testRule(id: string, data: TestAutomationRuleDto) {
    // Find the rule with all relations
    const rule = await this.findOne(id);

    if (!rule) {
      throw new Error(`Automation rule with id ${id} not found`);
    }

    // Create operation log for tracking
    const opLog = await this.operationLogService.create({
      title: `测试自动化规则: ${rule.name}`,
      triggerType: TriggerType.MANUAL,
      automationRuleId: rule.id,
      triggerContext: {
        testMode: true,
        customFacts: data.customFacts || null,
      },
    });

    // Queue the test execution as a background job
    await this.automationsQueue.add('test-automation-rule', {
      ruleId: id,
      opId: opLog.id,
      customFacts: data.customFacts,
    });

    return {
      taskId: opLog.id,
      message: `规则测试已启动: ${rule.name}`,
    };
  }

  /**
   * Create a rule from a template
   */
  async createFromTemplate(templateId: string, data: Partial<CreateAutomationRuleDto>): Promise<AutomationRuleWithRelations> {
    const template = await this.prisma.ruleTemplate.findUnique({
      where: { id: templateId },
      include: {
        triggerTemplates: true,
        eventTemplates: true,
        notificationTemplates: true
      }
    });

    if (!template) {
      throw new Error(`Rule template with id ${templateId} not found`);
    }

    // Create triggers from template
    const triggers: CreateTriggerDto[] = template.triggerTemplates.map(triggerTemplate => ({
      type: triggerTemplate.type,
      name: triggerTemplate.name,
      description: triggerTemplate.description || undefined,
      isEnabled: true,
      priority: 0,
      pluginId: '', // Will be resolved from plugin metadata
      pluginVersion: '1.0.0',
      config: triggerTemplate.defaultConfig as Record<string, any>,
      conditions: {}
    }));

    // Create events from template
    const events: CreateEventDto[] = template.eventTemplates.map(eventTemplate => ({
      type: eventTemplate.type,
      name: eventTemplate.name,
      description: eventTemplate.description || undefined,
      isEnabled: true,
      priority: 0,
      pluginId: '', // Will be resolved from plugin metadata
      pluginVersion: '1.0.0',
      params: eventTemplate.defaultParams as Record<string, any>
    }));

    // Create notifications from template
    const notifications: CreateNotificationDto[] = template.notificationTemplates.map(notificationTemplate => ({
      name: notificationTemplate.name,
      description: notificationTemplate.description || undefined,
      isEnabled: true,
      notifyOn: ['SUCCESS', 'FAILURE'] as ('SUCCESS' | 'FAILURE' | 'ALWAYS' | 'WARNING')[],
      templateId: notificationTemplate.id,
      channels: [{
        type: notificationTemplate.type,
        config: {},
        isEnabled: true
      }]
    }));

    // Resolve plugin IDs
    for (const trigger of triggers) {
      const plugin = await this.prisma.pluginMetadata.findFirst({
        where: { name: trigger.type, type: 'TRIGGER' }
      });
      if (plugin) {
        trigger.pluginId = plugin.id;
        trigger.pluginVersion = plugin.version;
      }
    }

    for (const event of events) {
      const plugin = await this.prisma.pluginMetadata.findFirst({
        where: { name: event.type, type: 'EVENT' }
      });
      if (plugin) {
        event.pluginId = plugin.id;
        event.pluginVersion = plugin.version;
      }
    }

    // Create the rule
    return this.create({
      name: data.name || `${template.name} - ${new Date().toISOString().split('T')[0]}`,
      description: data.description || template.description || undefined,
      isEnabled: data.isEnabled ?? true,
      priority: data.priority ?? 0,
      category: data.category || template.category,
      tags: data.tags || template.tags,
      templateId: template.id,
      triggers,
      events,
      notifications
    });
  }

  /**
   * Get rule execution statistics
   */
  async getRuleStats(id: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const [executions, metrics] = await Promise.all([
      this.prisma.ruleExecution.findMany({
        where: {
          ruleId: id,
          startedAt: {
            gte: startDate
          }
        },
        orderBy: { startedAt: 'desc' }
      }),
      this.prisma.ruleMetrics.findMany({
        where: {
          ruleId: id,
          date: {
            gte: startDate
          }
        },
        orderBy: { date: 'desc' }
      })
    ]);

    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter(e => e.status === 'COMPLETED').length;
    const failedExecutions = executions.filter(e => e.status === 'FAILED').length;
    const avgExecutionTime = executions.length > 0
      ? executions.reduce((sum, e) => sum + (e.duration || 0), 0) / executions.length
      : 0;

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0,
      avgExecutionTime,
      recentExecutions: executions.slice(0, 10),
      dailyMetrics: metrics
    };
  }

  /**
   * Enable or disable a rule
   */
  async toggleRule(id: string, enabled: boolean): Promise<AutomationRuleWithRelations> {
    return this.update(id, { isEnabled: enabled });
  }

  /**
   * Duplicate a rule
   */
  async duplicateRule(id: string, newName?: string): Promise<AutomationRuleWithRelations> {
    const originalRule = await this.findOne(id);

    if (!originalRule) {
      throw new Error(`Automation rule with id ${id} not found`);
    }

    const duplicateData: CreateAutomationRuleDto = {
      name: newName || `${originalRule.name} (Copy)`,
      description: originalRule.description || undefined,
      isEnabled: false, // Start disabled
      priority: originalRule.priority,
      category: originalRule.category || undefined,
      tags: originalRule.tags,
      templateId: originalRule.templateId || undefined,
      triggers: originalRule.triggers.map(trigger => ({
        type: trigger.type,
        name: trigger.name || undefined,
        description: trigger.description || undefined,
        isEnabled: trigger.isEnabled,
        priority: trigger.priority,
        pluginId: trigger.pluginId,
        pluginVersion: trigger.pluginVersion,
        config: trigger.config as Record<string, any>,
        conditions: trigger.conditions as Record<string, any>
      })),
      events: originalRule.events.map(event => ({
        type: event.type,
        name: event.name || undefined,
        description: event.description || undefined,
        isEnabled: event.isEnabled,
        priority: event.priority,
        pluginId: event.pluginId,
        pluginVersion: event.pluginVersion,
        params: event.params as Record<string, any>,
        options: event.options as Record<string, any>
      })),
      notifications: originalRule.notifications.map(notification => ({
        name: notification.name || undefined,
        description: notification.description || undefined,
        isEnabled: notification.isEnabled,
        notifyOn: notification.notifyOn as ('SUCCESS' | 'FAILURE' | 'ALWAYS' | 'WARNING')[],
        templateId: notification.templateId || undefined,
        channels: [] // Will need to be populated separately due to relation complexity
      }))
    };

    return this.create(duplicateData);
  }

  /**
   * Update triggers for a rule (replace strategy)
   */
  private async updateTriggers(
    tx: any,
    ruleId: string,
    triggers: any[],
    ruleName: string
  ): Promise<void> {
    // Delete existing triggers
    await tx.ruleTrigger.deleteMany({
      where: { ruleId }
    });

    // Create new triggers if provided
    if (triggers.length > 0) {
      const triggerData = triggers.map(trigger => ({
        ruleId,
        type: trigger.type,
        name: trigger.name || `${ruleName} - ${trigger.type}`,
        description: trigger.description,
        isEnabled: trigger.isEnabled ?? true,
        priority: trigger.priority ?? 0,
        pluginId: trigger.pluginId,
        pluginVersion: trigger.pluginVersion,
        config: typeof trigger.config === 'string' ? JSON.parse(trigger.config) : trigger.config,
        conditions: typeof trigger.conditions === 'string' ? JSON.parse(trigger.conditions || '{}') : (trigger.conditions || {})
      }));

      await tx.ruleTrigger.createMany({
        data: triggerData
      });

      console.log(`✅ Updated ${triggers.length} triggers for rule ${ruleId}`);
    } else {
      console.log(`✅ Removed all triggers for rule ${ruleId}`);
    }
  }

  /**
   * Update events for a rule (replace strategy)
   */
  private async updateEvents(
    tx: any,
    ruleId: string,
    events: any[],
    ruleName: string
  ): Promise<void> {
    // Delete existing events
    await tx.ruleEvent.deleteMany({
      where: { ruleId }
    });

    // Create new events if provided
    if (events.length > 0) {
      const eventData = events.map(event => {
        // Handle both direct config format and nested params format
        let params: Record<string, any> = {};

        if (event.params) {
          // Nested format: {params: {message: "...", level: "..."}}
          params = typeof event.params === 'string' ? JSON.parse(event.params) : event.params;
        } else {
          // Direct format: {message: "...", level: "...", timeout: 30}
          // Extract all non-standard fields as params
          const standardFields = ['type', 'name', 'description', 'isEnabled', 'priority', 'pluginId', 'pluginVersion', 'options'];
          params = Object.keys(event)
            .filter(key => !standardFields.includes(key))
            .reduce((acc, key) => {
              acc[key] = event[key];
              return acc;
            }, {} as Record<string, any>);
        }

        return {
          ruleId,
          type: event.type,
          name: event.name || `${ruleName} - ${event.type}`,
          description: event.description,
          isEnabled: event.isEnabled ?? true,
          priority: event.priority ?? 0,
          pluginId: event.pluginId,
          pluginVersion: event.pluginVersion,
          params,
          options: typeof event.options === 'string' ? JSON.parse(event.options || '{}') : (event.options || {})
        };
      });

      await tx.ruleEvent.createMany({
        data: eventData
      });

      console.log(`✅ Updated ${events.length} events for rule ${ruleId}`);
    } else {
      console.log(`✅ Removed all events for rule ${ruleId}`);
    }
  }

  /**
   * Update notifications for a rule (replace strategy)
   */
  private async updateNotifications(
    tx: any,
    ruleId: string,
    notifications: any[],
    ruleName: string
  ): Promise<void> {
    // Delete existing notifications and their channels (cascade delete should handle channels)
    await tx.ruleNotification.deleteMany({
      where: { ruleId }
    });

    // Create new notifications if provided
    if (notifications.length > 0) {
      for (const notification of notifications) {
        const createdNotification = await tx.ruleNotification.create({
          data: {
            ruleId,
            name: notification.name || `${ruleName} - notification`,
            description: notification.description,
            isEnabled: notification.isEnabled ?? true,
            notifyOn: notification.notifyOn as any,
            templateId: notification.templateId
          }
        });

        // Create notification channels
        if (notification.channels && notification.channels.length > 0) {
          const channelData = notification.channels.map((channel: any) => ({
            notificationId: createdNotification.id,
            type: channel.type,
            config: typeof channel.config === 'string' ? JSON.parse(channel.config) : channel.config,
            isEnabled: channel.isEnabled ?? true
          }));

          await tx.notificationChannel.createMany({
            data: channelData
          });
        }
      }

      console.log(`✅ Updated ${notifications.length} notifications for rule ${ruleId}`);
    } else {
      console.log(`✅ Removed all notifications for rule ${ruleId}`);
    }
  }

  /**
   * Validate update data before processing
   */
  private async validateUpdateData(ruleId: string, data: any): Promise<void> {
    const errors: string[] = [];

    try {
      // 1. Basic field validation
      if (data.name !== undefined) {
        if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
          errors.push('Rule name cannot be empty');
        } else if (data.name.length > 255) {
          errors.push('Rule name cannot exceed 255 characters');
        }
      }

      if (data.description !== undefined && data.description && data.description.length > 1000) {
        errors.push('Rule description cannot exceed 1000 characters');
      }

      if (data.priority !== undefined) {
        if (typeof data.priority !== 'number' || data.priority < 0 || data.priority > 100) {
          errors.push('Rule priority must be a number between 0 and 100');
        }
      }

      // 2. Validate triggers if provided
      if (data.triggers !== undefined) {
        if (!Array.isArray(data.triggers)) {
          errors.push('Triggers must be an array');
        } else {
          for (let i = 0; i < data.triggers.length; i++) {
            const trigger = data.triggers[i];
            const triggerErrors = await this.validateTrigger(trigger, i);
            errors.push(...triggerErrors);
          }
        }
      }

      // 3. Validate events if provided
      if (data.events !== undefined) {
        if (!Array.isArray(data.events)) {
          errors.push('Events must be an array');
        } else {
          for (let i = 0; i < data.events.length; i++) {
            const event = data.events[i];
            const eventErrors = await this.validateEvent(event, i);
            errors.push(...eventErrors);
          }
        }
      }

      // 4. Validate notifications if provided
      if (data.notifications !== undefined) {
        if (!Array.isArray(data.notifications)) {
          errors.push('Notifications must be an array');
        } else {
          for (let i = 0; i < data.notifications.length; i++) {
            const notification = data.notifications[i];
            const notificationErrors = this.validateNotification(notification, i);
            errors.push(...notificationErrors);
          }
        }
      }

      // 5. Check for name uniqueness if name is being changed
      if (data.name) {
        const existingRule = await this.prisma.automationRule.findFirst({
          where: {
            name: data.name,
            id: { not: ruleId }
          }
        });

        if (existingRule) {
          errors.push(`Rule name "${data.name}" already exists`);
        }
      }

      // Throw validation errors if any
      if (errors.length > 0) {
        this.logger.warn(`Validation failed for rule ${ruleId}:`, errors);
        throw new BadRequestException(`Validation failed: ${errors.join('; ')}`);
      }

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Validation error for rule ${ruleId}:`, error);
      throw new InternalServerErrorException('Validation failed due to internal error');
    }
  }

  /**
   * Validate a single trigger
   */
  private async validateTrigger(trigger: any, index: number): Promise<string[]> {
    const errors: string[] = [];
    const prefix = `Trigger ${index + 1}`;

    if (!trigger.type || typeof trigger.type !== 'string') {
      errors.push(`${prefix}: type is required and must be a string`);
    }

    if (!trigger.pluginId || typeof trigger.pluginId !== 'string') {
      errors.push(`${prefix}: pluginId is required and must be a string`);
    } else {
      // Verify plugin exists
      const plugin = await this.prisma.pluginMetadata.findUnique({
        where: { id: trigger.pluginId }
      });

      // 检查插件注册表中是否存在该类型的触发器插件
      const triggerPlugin = this.pluginRegistry.getTriggerPlugin(trigger.type);
      if (!triggerPlugin) {
        errors.push(`${prefix}: No trigger plugin found for type '${trigger.type}'`);
      }

      // 检查数据库中的插件元数据是否存在
      if (!plugin) {
        errors.push(`${prefix}: Plugin metadata with ID ${trigger.pluginId} not found in database`);
      } else if (trigger.pluginVersion && plugin.version !== trigger.pluginVersion) {
        errors.push(`${prefix}: Plugin version mismatch. Expected: ${plugin.version}, Got: ${trigger.pluginVersion}`);
      }
    }

    // Validate config JSON
    if (trigger.config !== undefined) {
      try {
        if (typeof trigger.config === 'string') {
          JSON.parse(trigger.config);
        } else if (typeof trigger.config !== 'object') {
          errors.push(`${prefix}: config must be a JSON string or object`);
        }
      } catch (e) {
        errors.push(`${prefix}: config contains invalid JSON`);
      }
    }

    return errors;
  }

  /**
   * Validate a single event using plugin-specific validation
   */
  private async validateEvent(event: any, index: number): Promise<string[]> {
    const errors: string[] = [];
    const prefix = `Event ${index + 1}`;

    // Basic structure validation
    if (!event.type || typeof event.type !== 'string') {
      errors.push(`${prefix}: type is required and must be a string`);
      return errors; // Can't proceed without type
    }

    if (!event.pluginId || typeof event.pluginId !== 'string') {
      errors.push(`${prefix}: pluginId is required and must be a string`);
    } else {
      // Verify plugin exists
      const plugin = await this.prisma.pluginMetadata.findUnique({
        where: { id: event.pluginId }
      });

      // 检查插件注册表中是否存在该类型的事件插件
      const eventPlugin = this.pluginRegistry.getEventPlugin(event.type);
      if (!eventPlugin) {
        errors.push(`${prefix}: No event plugin found for type '${event.type}'`);
      }

      // 检查数据库中的插件元数据是否存在
      if (!plugin) {
        errors.push(`${prefix}: Plugin metadata with ID ${event.pluginId} not found in database`);
      } else if (event.pluginVersion && plugin.version !== event.pluginVersion) {
        errors.push(`${prefix}: Plugin version mismatch. Expected: ${plugin.version}, Got: ${event.pluginVersion}`);
      }

      // 如果插件存在，进行插件特定的验证
      if (plugin && eventPlugin) {
        // Use plugin-specific validation instead of generic validation
        try {
          // For now, just validate that params is valid JSON if it's a string
          // The actual plugin-specific validation will be handled by the plugin system
          if (event.params !== undefined) {
            if (typeof event.params === 'string') {
              JSON.parse(event.params);
            } else if (typeof event.params !== 'object') {
              errors.push(`${prefix}: params must be a JSON string or object`);
            }
          }

          // Note: Plugin-specific validation will be handled by the automation engine
          // during actual execution. This basic validation ensures the data structure is correct.
        } catch (e) {
          errors.push(`${prefix}: params contains invalid JSON`);
        }
      }
    }

    return errors;
  }

  /**
   * Validate a single notification
   */
  private validateNotification(notification: any, index: number): string[] {
    const errors: string[] = [];
    const prefix = `Notification ${index + 1}`;

    if (notification.notifyOn !== undefined) {
      const validValues = ['SUCCESS', 'FAILURE', 'ALWAYS', 'WARNING'];
      if (!Array.isArray(notification.notifyOn)) {
        errors.push(`${prefix}: notifyOn must be an array`);
      } else {
        for (const value of notification.notifyOn) {
          if (!validValues.includes(value)) {
            errors.push(`${prefix}: notifyOn contains invalid value "${value}". Valid values: ${validValues.join(', ')}`);
          }
        }
      }
    }

    if (notification.channels !== undefined) {
      if (!Array.isArray(notification.channels)) {
        errors.push(`${prefix}: channels must be an array`);
      } else {
        for (let i = 0; i < notification.channels.length; i++) {
          const channel = notification.channels[i];
          if (!channel.type || typeof channel.type !== 'string') {
            errors.push(`${prefix} Channel ${i + 1}: type is required and must be a string`);
          }

          // Validate channel config JSON
          if (channel.config !== undefined) {
            try {
              if (typeof channel.config === 'string') {
                JSON.parse(channel.config);
              } else if (typeof channel.config !== 'object') {
                errors.push(`${prefix} Channel ${i + 1}: config must be a JSON string or object`);
              }
            } catch (e) {
              errors.push(`${prefix} Channel ${i + 1}: config contains invalid JSON`);
            }
          }
        }
      }
    }

    return errors;
  }

  /**
   * Create audit log entry for update operations
   */
  private async createAuditLogEntry(
    ruleId: string,
    beforeSnapshot: any,
    afterSnapshot: any,
    updateData: any,
    duration: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      // Determine changed fields
      const changedFields: string[] = [];
      if (updateData.name !== undefined) changedFields.push('name');
      if (updateData.description !== undefined) changedFields.push('description');
      if (updateData.isEnabled !== undefined) changedFields.push('isEnabled');
      if (updateData.priority !== undefined) changedFields.push('priority');
      if (updateData.category !== undefined) changedFields.push('category');
      if (updateData.tags !== undefined) changedFields.push('tags');

      const triggersChanged = updateData.triggers !== undefined;
      const eventsChanged = updateData.events !== undefined;
      const notificationsChanged = updateData.notifications !== undefined;

      if (triggersChanged) changedFields.push('triggers');
      if (eventsChanged) changedFields.push('events');
      if (notificationsChanged) changedFields.push('notifications');

      // Create audit log entry
      await this.auditLogService.logUpdate({
        ruleId,
        operationType: 'UPDATE',
        timestamp: new Date(),
        beforeSnapshot,
        afterSnapshot,
        changedFields,
        triggersChanged,
        eventsChanged,
        notificationsChanged,
        success,
        errorMessage,
        duration
      });

    } catch (auditError) {
      // Don't let audit logging failures affect the main operation
      this.logger.error(`Failed to create audit log for rule ${ruleId}:`, auditError);
    }
  }

  /**
   * Get audit history for a rule
   */
  async getAuditHistory(ruleId: string, limit: number = 50): Promise<any[]> {
    return await this.auditLogService.getAuditHistory(ruleId, limit);
  }

  /**
   * Create version snapshot
   */
  async createVersionSnapshot(ruleId: string, version: string): Promise<void> {
    const rule = await this.findOne(ruleId);
    if (rule) {
      await this.auditLogService.createVersionSnapshot(ruleId, version, rule);
    }
  }

  /**
   * Get version history
   */
  async getVersionHistory(ruleId: string): Promise<any[]> {
    return await this.auditLogService.getVersionHistory(ruleId);
  }

  /**
   * Restore from version snapshot
   */
  async restoreFromSnapshot(ruleId: string, snapshotId: string): Promise<AutomationRuleWithRelations> {
    const snapshotData = await this.auditLogService.getVersionSnapshot(ruleId, snapshotId);
    if (!snapshotData) {
      throw new NotFoundException(`Version snapshot ${snapshotId} not found for rule ${ruleId}`);
    }

    // Use the update method to restore the configuration
    return await this.update(ruleId, snapshotData);
  }
}
