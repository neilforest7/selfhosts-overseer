import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PluginRegistry } from '../registry/plugin-registry.service';
import {
  TriggerContext,
  EventContext,
  TriggerConfig,
  EventConfig,
  TriggerResult,
  EventResult
} from '../interfaces';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { ContextService } from '../../../context/context.service';
import { TriggerType } from '@prisma/client';

export interface AutomationRule {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  triggers: TriggerConfig[];
  events: EventConfig[];
  conditions?: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface RuleEvaluationContext {
  rule: AutomationRule;
  timestamp: Date;
  facts: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface RuleExecutionResult {
  rule: AutomationRule;
  triggered: boolean;
  triggerResults: Array<{
    triggerType: string;
    result: TriggerResult;
  }>;
  eventResults?: Array<{
    eventType: string;
    result: EventResult;
  }>;
  executionTime: number;
  error?: string;
}

/**
 * Plugin-based automation engine
 * Evaluates automation rules using registered trigger and event plugins
 */
@Injectable()
export class AutomationEngine implements OnModuleInit {
  private readonly logger = new Logger(AutomationEngine.name);
  
  constructor(
    private readonly pluginRegistry: PluginRegistry,
    private readonly operationLogService: OperationLogService,
    private readonly prisma: PrismaService,
    private readonly contextService: ContextService
  ) {}
  
  async onModuleInit(): Promise<void> {
    this.logger.log('Automation Engine initialized');
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
  
  /**
   * Evaluate all enabled automation rules
   */
  async evaluateAllRules(facts: Record<string, any>, metadata?: Record<string, any>): Promise<RuleExecutionResult[]> {
    const startTime = Date.now();
    
    try {
      // Get all enabled rules
      const rules = await this.getEnabledRules();
      
      this.logger.debug(`Evaluating ${rules.length} automation rules`);
      
      const results: RuleExecutionResult[] = [];
      
      for (const rule of rules) {
        try {
          const result = await this.evaluateRule(rule, facts, metadata);
          results.push(result);
          
          if (result.triggered && result.eventResults) {
            this.logger.log(`Rule '${rule.name}' triggered ${result.eventResults.length} events`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Error evaluating rule '${rule.name}': ${errorMessage}`, error);
          results.push({
            rule,
            triggered: false,
            triggerResults: [],
            executionTime: Date.now() - startTime,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
      
      const totalTime = Date.now() - startTime;
      this.logger.debug(`Rule evaluation completed in ${totalTime}ms`);
      
      return results;
      
    } catch (error) {
      this.logger.error('Error during rule evaluation', error);
      throw error;
    }
  }
  
  /**
   * Evaluate a single automation rule
   */
  async evaluateRule(
    rule: AutomationRule, 
    facts: Record<string, any>, 
    metadata?: Record<string, any>
  ): Promise<RuleExecutionResult> {
    const startTime = Date.now();
    
    try {
      if (!rule.isEnabled) {
        return {
          rule,
          triggered: false,
          triggerResults: [],
          executionTime: Date.now() - startTime
        };
      }
      
      const context: RuleEvaluationContext = {
        rule,
        timestamp: new Date(),
        facts,
        metadata
      };
      
      // Evaluate all triggers
      const triggerResults = await this.evaluateTriggers(rule.triggers, context);
      
      // Check if any trigger fired
      const triggered = triggerResults.some(tr => tr.result.shouldTrigger);
      
      let eventResults: Array<{ eventType: string; result: EventResult; }> | undefined;
      
      if (triggered) {
        // Execute events
        eventResults = await this.executeEvents(rule.events, context, triggerResults);
      }
      
      return {
        rule,
        triggered,
        triggerResults,
        eventResults,
        executionTime: Date.now() - startTime
      };
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error evaluating rule '${rule.name}': ${errorMessage}`, error);
      return {
        rule,
        triggered: false,
        triggerResults: [],
        executionTime: Date.now() - startTime,
        error: errorMessage
      };
    }
  }
  
  /**
   * Test a rule with custom facts
   */
  async testRule(
    ruleId: string, 
    customFacts?: Record<string, any>,
    metadata?: Record<string, any>
  ): Promise<RuleExecutionResult> {
    try {
      const rule = await this.getRuleById(ruleId);
      if (!rule) {
        throw new Error(`Rule with ID '${ruleId}' not found`);
      }
      
      // Use custom facts or gather real facts
      const facts = customFacts || await this.gatherSystemFacts();
      
      // Add test mode metadata
      const testMetadata = {
        ...metadata,
        testMode: true,
        testRunAt: new Date()
      };
      
      return this.evaluateRule(rule, facts, testMetadata);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error testing rule '${ruleId}': ${errorMessage}`, error);
      throw error;
    }
  }
  
  /**
   * Execute a rule manually
   */
  async executeRule(
    ruleId: string,
    metadata?: Record<string, any>
  ): Promise<RuleExecutionResult> {
    try {
      const rule = await this.getRuleById(ruleId);
      if (!rule) {
        throw new Error(`Rule with ID '${ruleId}' not found`);
      }
      
      const facts = await this.gatherSystemFacts();
      
      // Add manual execution metadata
      const executionMetadata = {
        ...metadata,
        manual: true,
        executedAt: new Date()
      };
      
      return this.evaluateRule(rule, facts, executionMetadata);
      
    } catch (error) {
      this.logger.error(`Error executing rule '${ruleId}': ${this.getErrorMessage(error)}`, error);
      throw error;
    }
  }
  
  /**
   * Get available trigger types
   */
  getAvailableTriggerTypes(): Array<{ type: string; name: string; description: string; }> {
    const triggerPlugins = this.pluginRegistry.getTriggerPlugins();
    return Array.from(triggerPlugins.values()).map(plugin => ({
      type: plugin.triggerType,
      name: plugin.name,
      description: plugin.description
    }));
  }
  
  /**
   * Get available event types
   */
  getAvailableEventTypes(): Array<{ type: string; name: string; description: string; }> {
    const eventPlugins = this.pluginRegistry.getEventPlugins();
    return Array.from(eventPlugins.values()).map(plugin => ({
      type: plugin.eventType,
      name: plugin.name,
      description: plugin.description
    }));
  }
  
  /**
   * Get trigger configuration schema
   */
  getTriggerConfigSchema(triggerType: string): Record<string, any> | null {
    const plugin = this.pluginRegistry.getTriggerPlugin(triggerType);
    return plugin ? plugin.getTriggerConfigSchema() : null;
  }
  
  /**
   * Get event configuration schema
   */
  getEventConfigSchema(eventType: string): Record<string, any> | null {
    const plugin = this.pluginRegistry.getEventPlugin(eventType);
    return plugin ? plugin.getEventConfigSchema() : null;
  }
  
  /**
   * Validate rule configuration
   */
  async validateRule(rule: Partial<AutomationRule>): Promise<{
    valid: boolean;
    errors: string[];
  }> {
    const errors: string[] = [];
    
    try {
      // Validate basic structure
      if (!rule.name || rule.name.trim().length === 0) {
        errors.push('Rule name is required');
      }
      
      if (!rule.triggers || !Array.isArray(rule.triggers) || rule.triggers.length === 0) {
        errors.push('At least one trigger is required');
      }
      
      if (!rule.events || !Array.isArray(rule.events) || rule.events.length === 0) {
        errors.push('At least one event is required');
      }
      
      // Validate triggers
      if (rule.triggers) {
        for (let i = 0; i < rule.triggers.length; i++) {
          const trigger = rule.triggers[i];
          const plugin = this.pluginRegistry.getTriggerPlugin(trigger.type);
          
          if (!plugin) {
            errors.push(`Unknown trigger type '${trigger.type}' at index ${i}`);
            continue;
          }
          
          try {
            const isValid = await plugin.validateTriggerConfig(trigger);
            if (!isValid) {
              errors.push(`Invalid trigger configuration at index ${i}`);
            }
          } catch (error) {
            errors.push(`Trigger validation error at index ${i}: ${this.getErrorMessage(error)}`);
          }
        }
      }
      
      // Validate events
      if (rule.events) {
        for (let i = 0; i < rule.events.length; i++) {
          const event = rule.events[i];
          const plugin = this.pluginRegistry.getEventPlugin(event.type);
          
          if (!plugin) {
            errors.push(`Unknown event type '${event.type}' at index ${i}`);
            continue;
          }
          
          try {
            const isValid = await plugin.validateEventConfig(event);
            if (!isValid) {
              errors.push(`Invalid event configuration at index ${i}`);
            }
          } catch (error) {
            errors.push(`Event validation error at index ${i}: ${this.getErrorMessage(error)}`);
          }
        }
      }
      
    } catch (error) {
      errors.push(`Rule validation error: ${this.getErrorMessage(error)}`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
  
  /**
   * Evaluate triggers for a rule
   */
  private async evaluateTriggers(
    triggers: TriggerConfig[], 
    context: RuleEvaluationContext
  ): Promise<Array<{ triggerType: string; result: TriggerResult; }>> {
    const results: Array<{ triggerType: string; result: TriggerResult; }> = [];
    
    for (const triggerConfig of triggers) {
      try {
        const plugin = this.pluginRegistry.getTriggerPlugin(triggerConfig.type);
        if (!plugin) {
          this.logger.warn(`No plugin found for trigger type: ${triggerConfig.type}`);
          continue;
        }
        
        const triggerContext: TriggerContext = {
          timestamp: context.timestamp,
          facts: context.facts,
          metadata: context.metadata
        };
        
        const result = await plugin.evaluate(triggerConfig, triggerContext);
        
        results.push({
          triggerType: triggerConfig.type,
          result
        });
        
      } catch (error) {
        this.logger.error(`Error evaluating trigger '${triggerConfig.type}': ${this.getErrorMessage(error)}`, error);
        results.push({
          triggerType: triggerConfig.type,
          result: {
            shouldTrigger: false,
            reason: `Error: ${this.getErrorMessage(error)}`
          }
        });
      }
    }
    
    return results;
  }
  
  /**
   * Execute events for a rule
   */
  private async executeEvents(
    events: EventConfig[],
    context: RuleEvaluationContext,
    triggerResults: Array<{ triggerType: string; result: TriggerResult; }>
  ): Promise<Array<{ eventType: string; result: EventResult; }>> {
    const results: Array<{ eventType: string; result: EventResult; }> = [];

    // Only create operation log for non-test mode executions
    // In test mode, we use the existing operation log from the test request
    const isTestMode = context.metadata?.testMode === true;
    let opLog: any = null;

    if (!isTestMode) {
      // Create operation log for tracking
      opLog = await this.operationLogService.create({
        title: `Automation: ${context.rule.name}`,
        triggerType: TriggerType.EVENT,
        automationRuleId: context.rule.id,
        triggerContext: {
          triggers: triggerResults,
          timestamp: context.timestamp,
          metadata: context.metadata
        } as any,
      });
    }
    
    for (const eventConfig of events) {
      try {
        const plugin = this.pluginRegistry.getEventPlugin(eventConfig.type);
        if (!plugin) {
          this.logger.warn(`No plugin found for event type: ${eventConfig.type}`);
          continue;
        }
        
        const eventContext: EventContext = {
          params: eventConfig.params,
          triggerResult: triggerResults[0]?.result, // Pass first trigger result
          rule: {
            id: context.rule.id,
            name: context.rule.name,
            description: context.rule.description
          },
          operationLogId: opLog?.id || (isTestMode ? this.contextService.getOpId() : undefined), // Use current context opId in test mode
          metadata: context.metadata
        };
        
        // Check if event can be executed
        const canExecute = plugin.canExecute ? await plugin.canExecute(eventConfig, eventContext) : true;
        if (!canExecute) {
          results.push({
            eventType: eventConfig.type,
            result: {
              success: false,
              error: 'Event execution not allowed'
            }
          });
          continue;
        }
        
        const result = await plugin.execute(eventConfig, eventContext);
        
        results.push({
          eventType: eventConfig.type,
          result
        });
        
      } catch (error) {
        this.logger.error(`Error executing event '${eventConfig.type}': ${this.getErrorMessage(error)}`, error);
        results.push({
          eventType: eventConfig.type,
          result: {
            success: false,
            error: this.getErrorMessage(error)
          }
        });
      }
    }
    
    // Update operation log status (only for non-test mode)
    if (opLog) {
      const hasErrors = results.some(r => !r.result.success);
      await this.operationLogService.updateStatus(opLog.id, hasErrors ? 'ERROR' : 'COMPLETED');
    }
    
    return results;
  }
  
  /**
   * Get all enabled automation rules from database with normalized schema
   */
  private async getEnabledRules(): Promise<AutomationRule[]> {
    this.logger.debug('Fetching enabled automation rules from database...');

    const rules = await this.prisma.automationRule.findMany({
      where: { isEnabled: true },
      include: {
        triggers: {
          where: { isEnabled: true },
          include: {
            plugin: true
          },
          orderBy: { priority: 'desc' }
        },
        events: {
          where: { isEnabled: true },
          include: {
            plugin: true
          },
          orderBy: { priority: 'desc' }
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
    });

    this.logger.debug(`Found ${rules.length} enabled rules in database`);

    for (const rule of rules) {
      this.logger.debug(`Rule: ${rule.name} (${rule.id}) - Triggers: ${rule.triggers.length}, Events: ${rule.events.length}`);
    }

    const convertedRules = rules.map(rule => this.convertDatabaseRule(rule));
    this.logger.debug(`Converted ${convertedRules.length} rules for evaluation`);

    return convertedRules;
  }
  
  /**
   * Get rule by ID with all relations
   */
  private async getRuleById(ruleId: string): Promise<AutomationRule | null> {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId },
      include: {
        triggers: {
          where: { isEnabled: true },
          include: {
            plugin: true
          },
          orderBy: { priority: 'desc' }
        },
        events: {
          where: { isEnabled: true },
          include: {
            plugin: true
          },
          orderBy: { priority: 'desc' }
        },
        notifications: {
          where: { isEnabled: true },
          include: {
            channels: {
              where: { isEnabled: true }
            }
          }
        }
      }
    });

    return rule ? this.convertDatabaseRule(rule) : null;
  }
  
  /**
   * Convert database rule to AutomationRule format
   */
  private convertDatabaseRule(dbRule: any): AutomationRule {
    // Check if rule uses new normalized schema (has triggers/events relations)
    if (dbRule.triggers && dbRule.events) {
      // New normalized schema format
      return {
        id: dbRule.id,
        name: dbRule.name,
        description: dbRule.description,
        isEnabled: dbRule.isEnabled,
        triggers: dbRule.triggers.map((trigger: any) => ({
          type: trigger.type,
          config: trigger.config,
          enabled: trigger.isEnabled,
          conditions: trigger.conditions,
          metadata: {
            pluginId: trigger.pluginId,
            pluginVersion: trigger.pluginVersion,
            name: trigger.name,
            description: trigger.description,
            priority: trigger.priority
          }
        })),
        events: dbRule.events.map((event: any) => ({
          type: event.type,
          params: event.params,
          enabled: event.isEnabled,
          metadata: {
            pluginId: event.pluginId,
            pluginVersion: event.pluginVersion,
            name: event.name,
            description: event.description,
            priority: event.priority,
            options: event.options
          }
        })),
        conditions: {},
        metadata: {
          normalized: true,
          priority: dbRule.priority,
          category: dbRule.category,
          tags: dbRule.tags,
          version: dbRule.version,
          templateId: dbRule.templateId,
          organizationId: dbRule.organizationId,
          notifications: dbRule.notifications
        }
      };
    }

    // Check if it's legacy JSON format
    if (dbRule.ruleJson) {
      const ruleJson = dbRule.ruleJson as any;

      // Check if it's new plugin format in JSON
      if (ruleJson.triggers && ruleJson.events) {
        return {
          id: dbRule.id,
          name: dbRule.name,
          description: dbRule.description,
          isEnabled: dbRule.isEnabled,
          triggers: ruleJson.triggers,
          events: ruleJson.events,
          conditions: ruleJson.conditions,
          metadata: ruleJson.metadata
        };
      }

      // Legacy json-rules-engine format - convert to plugin format
      return this.convertLegacyRule(dbRule);
    }

    // Fallback - create a manual trigger rule
    this.logger.warn(`Rule ${dbRule.id} has no triggers or events, creating manual trigger`);
    return {
      id: dbRule.id,
      name: dbRule.name,
      description: dbRule.description,
      isEnabled: dbRule.isEnabled,
      triggers: [{
        type: 'manual',
        config: {},
        enabled: true
      }],
      events: [{
        type: 'log-message',
        params: {
          message: `Rule ${dbRule.name} executed manually`,
          level: 'info'
        },
        enabled: true
      }],
      conditions: {},
      metadata: { fallback: true }
    };
  }
  
  /**
   * Convert legacy json-rules-engine rule to plugin format
   */
  private convertLegacyRule(dbRule: any): AutomationRule {
    const ruleJson = dbRule.ruleJson as any;
    
    // Extract CRON trigger if present
    const triggers: TriggerConfig[] = [];
    const events: EventConfig[] = [];
    
    // Look for CRON conditions
    if (this.hasTimeCondition(ruleJson.conditions)) {
      triggers.push({
        type: 'cron',
        config: {
          expression: this.extractCronExpression(ruleJson.conditions) || '0 * * * *'
        },
        enabled: true
      });
    }

    // Look for manual trigger conditions
    if (this.hasManualTriggerCondition(ruleJson.conditions)) {
      triggers.push({
        type: 'manual',
        config: {},
        enabled: true
      });
    }
    
    // Convert event
    if (ruleJson.event) {
      events.push({
        type: ruleJson.event.type,
        params: ruleJson.event.params || {},
        enabled: true
      });
    }
    
    return {
      id: dbRule.id,
      name: dbRule.name,
      description: dbRule.description,
      isEnabled: dbRule.isEnabled,
      triggers,
      events,
      conditions: ruleJson.conditions,
      metadata: { legacy: true }
    };
  }
  
  /**
   * Check if conditions contain time-based rules
   */
  private hasTimeCondition(conditions: any): boolean {
    if (!conditions) return false;

    const checkCondition = (condition: any): boolean => {
      if (condition.fact === 'time' || condition.fact === 'time-schedule') {
        return true;
      }
      if (condition.all) {
        return condition.all.some(checkCondition);
      }
      if (condition.any) {
        return condition.any.some(checkCondition);
      }
      return false;
    };

    return checkCondition(conditions);
  }

  /**
   * Check if conditions contain manual trigger rules
   */
  private hasManualTriggerCondition(conditions: any): boolean {
    if (!conditions) return false;

    const checkCondition = (condition: any): boolean => {
      if (condition.fact === 'trigger' && condition.params?.type === 'manual') {
        return true;
      }
      if (condition.all) {
        return condition.all.some(checkCondition);
      }
      if (condition.any) {
        return condition.any.some(checkCondition);
      }
      return false;
    };

    return checkCondition(conditions);
  }
  
  /**
   * Extract CRON expression from conditions
   */
  private extractCronExpression(conditions: any): string | null {
    if (!conditions) return null;
    
    const findCron = (condition: any): string | null => {
      if (condition.operator === 'matchesCron') {
        return condition.value;
      }
      if (condition.all) {
        for (const subCondition of condition.all) {
          const result = findCron(subCondition);
          if (result) return result;
        }
      }
      if (condition.any) {
        for (const subCondition of condition.any) {
          const result = findCron(subCondition);
          if (result) return result;
        }
      }
      return null;
    };
    
    return findCron(conditions);
  }
  
  /**
   * Gather system facts for rule evaluation
   */
  private async gatherSystemFacts(): Promise<Record<string, any>> {
    // This would gather facts from various services
    // For now, return basic time facts
    const now = new Date();
    
    return {
      time: {
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.getDay(),
        dayOfMonth: now.getDate(),
        month: now.getMonth() + 1,
        year: now.getFullYear(),
        timestamp: now.getTime(),
        iso: now.toISOString()
      },
      system: {
        timestamp: now.getTime(),
        uptime: process.uptime()
      }
    };
  }
}