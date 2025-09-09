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
    private readonly prisma: PrismaService
  ) {}
  
  async onModuleInit(): Promise<void> {
    this.logger.log('Automation Engine initialized');
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
          this.logger.error(`Error evaluating rule '${rule.name}': ${error.message}`, error);
          results.push({
            rule,
            triggered: false,
            triggerResults: [],
            executionTime: Date.now() - startTime,
            error: error.message
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
      this.logger.error(`Error evaluating rule '${rule.name}': ${error.message}`, error);
      return {
        rule,
        triggered: false,
        triggerResults: [],
        executionTime: Date.now() - startTime,
        error: error.message
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
      this.logger.error(`Error testing rule '${ruleId}': ${error.message}`, error);
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
      this.logger.error(`Error executing rule '${ruleId}': ${error.message}`, error);
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
            errors.push(`Trigger validation error at index ${i}: ${error.message}`);
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
            errors.push(`Event validation error at index ${i}: ${error.message}`);
          }
        }
      }
      
    } catch (error) {
      errors.push(`Rule validation error: ${error.message}`);
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
        this.logger.error(`Error evaluating trigger '${triggerConfig.type}': ${error.message}`, error);
        results.push({
          triggerType: triggerConfig.type,
          result: {
            shouldTrigger: false,
            reason: `Error: ${error.message}`
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
    
    // Create operation log for tracking
    const opLog = await this.operationLogService.create({
      title: `Automation: ${context.rule.name}`,
      triggerType: TriggerType.EVENT,
      automationRuleId: context.rule.id,
      triggerContext: {
        triggers: triggerResults,
        timestamp: context.timestamp,
        metadata: context.metadata
      } as any,
    });
    
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
          operationLogId: opLog.id,
          metadata: context.metadata
        };
        
        // Check if event can be executed
        const canExecute = await plugin.canExecute(eventConfig, eventContext);
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
        this.logger.error(`Error executing event '${eventConfig.type}': ${error.message}`, error);
        results.push({
          eventType: eventConfig.type,
          result: {
            success: false,
            error: error.message
          }
        });
      }
    }
    
    // Update operation log status
    const hasErrors = results.some(r => !r.result.success);
    await this.operationLogService.updateStatus(opLog.id, hasErrors ? 'ERROR' : 'COMPLETED');
    
    return results;
  }
  
  /**
   * Get all enabled automation rules from database
   */
  private async getEnabledRules(): Promise<AutomationRule[]> {
    const rules = await this.prisma.automationRule.findMany({
      where: { isEnabled: true }
    });
    
    return rules.map(rule => this.convertDatabaseRule(rule));
  }
  
  /**
   * Get rule by ID
   */
  private async getRuleById(ruleId: string): Promise<AutomationRule | null> {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId }
    });
    
    return rule ? this.convertDatabaseRule(rule) : null;
  }
  
  /**
   * Convert database rule to AutomationRule format
   */
  private convertDatabaseRule(dbRule: any): AutomationRule {
    // For now, we'll support both old json-rules-engine format and new plugin format
    const ruleJson = dbRule.ruleJson as any;
    
    // Check if it's new plugin format
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
    
    // Legacy format - convert to plugin format
    return this.convertLegacyRule(dbRule);
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