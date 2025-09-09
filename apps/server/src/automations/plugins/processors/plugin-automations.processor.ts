import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';

import { AutomationEngine } from '../engine/automation-engine.service';
import { PluginRegistry } from '../registry/plugin-registry.service';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { TriggerType } from '@prisma/client';
import { ContextService } from '../../../context/context.service';

export const AUTOMATION_QUEUE_NAME = 'automation-queue';
export const AUTOMATION_JOB_NAME = 'evaluate-rules';

/**
 * Plugin-based automation processor
 * Replaces the original processor with plugin system support
 */
@Injectable()
@Processor(AUTOMATION_QUEUE_NAME)
export class PluginAutomationsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(PluginAutomationsProcessor.name);

  constructor(
    @InjectQueue(AUTOMATION_QUEUE_NAME) private readonly automationQueue: Queue,
    private readonly automationEngine: AutomationEngine,
    private readonly pluginRegistry: PluginRegistry,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing Plugin-based Automation Processor...');
    
    // Register built-in plugins
    await this.registerBuiltinPlugins();
    
    // Schedule rule evaluation job
    await this.scheduleRuleEvaluation();
    
    this.logger.log('Plugin-based Automation Processor initialized successfully');
  }

  async process(job: Job<any, any, string>): Promise<void> {
    this.logger.debug(`Processing job: ${job.name}`);
    
    try {
      switch (job.name) {
        case AUTOMATION_JOB_NAME:
          await this.evaluateAllRules();
          break;
          
        case 'execute-rule':
          const { ruleId, metadata } = job.data;
          await this.executeRule(ruleId, metadata);
          break;
          
        case 'test-rule':
          const { ruleId: testRuleId, opId, customFacts } = job.data;
          await this.testRule(testRuleId, opId, customFacts);
          break;
          
        default:
          this.logger.warn(`Unknown job type: ${job.name}`);
      }
    } catch (error) {
      this.logger.error(`Error processing job ${job.name}: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Evaluate all enabled automation rules
   */
  private async evaluateAllRules(): Promise<void> {
    try {
      const facts = await this.gatherSystemFacts();
      const results = await this.automationEngine.evaluateAllRules(facts);
      
      const triggeredCount = results.filter(r => r.triggered).length;
      
      if (triggeredCount > 0) {
        this.logger.log(`Evaluated ${results.length} rules, ${triggeredCount} triggered`);
      } else {
        this.logger.debug(`Evaluated ${results.length} rules, none triggered`);
      }
      
    } catch (error) {
      this.logger.error('Error evaluating automation rules', error);
      throw error;
    }
  }

  /**
   * Execute a specific rule manually
   */
  private async executeRule(ruleId: string, metadata?: Record<string, any>): Promise<void> {
    try {
      this.logger.log(`Manually executing rule: ${ruleId}`);
      
      const result = await this.automationEngine.executeRule(ruleId, metadata);
      
      if (result.triggered) {
        this.logger.log(`Rule '${result.rule.name}' executed successfully`);
      } else {
        this.logger.debug(`Rule '${result.rule.name}' conditions not met`);
      }
      
    } catch (error) {
      this.logger.error(`Error executing rule ${ruleId}: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Test a rule with custom facts
   */
  private async testRule(ruleId: string, opId: string, customFacts?: Record<string, any>): Promise<void> {
    return this.contextService.run(opId, async () => {
      let isFailed = false;
      
      try {
        this.operationLogService.log('info', `开始测试自动化规则 ${ruleId}`);
        
        const result = await this.automationEngine.testRule(ruleId, customFacts, { testMode: true });
        
        this.operationLogService.log('info', `规则名称: ${result.rule.name}`);
        this.operationLogService.log('info', `规则状态: ${result.rule.isEnabled ? '启用' : '禁用'}`);
        
        // Log trigger results
        for (const triggerResult of result.triggerResults) {
          this.operationLogService.log('info', 
            `触发器 ${triggerResult.triggerType}: ${triggerResult.result.shouldTrigger ? '✓' : '✗'} - ${triggerResult.result.reason || 'No reason provided'}`
          );
        }
        
        // Log event results if rule was triggered
        if (result.triggered && result.eventResults) {
          this.operationLogService.log('info', `规则触发，执行了 ${result.eventResults.length} 个事件`);
          
          for (const eventResult of result.eventResults) {
            const status = eventResult.result.success ? '✓' : '✗';
            const message = eventResult.result.message || eventResult.result.error || 'No message';
            this.operationLogService.log('info', `事件 ${eventResult.eventType}: ${status} - ${message}`);
          }
        } else {
          this.operationLogService.log('info', '规则条件未满足，未执行任何事件');
        }
        
        this.operationLogService.log('info', `测试完成，执行时间: ${result.executionTime}ms`);
        
        if (result.error) {
          isFailed = true;
          this.operationLogService.log('error', `测试错误: ${result.error}`);
        }
        
      } catch (error) {
        isFailed = true;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error testing rule ${ruleId}: ${errorMessage}`, error);
        this.operationLogService.log('error', `测试失败: ${errorMessage}`);
      } finally {
        await this.operationLogService.updateStatus(opId, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });
  }

  /**
   * Register built-in plugins
   */
  private async registerBuiltinPlugins(): Promise<void> {
    this.logger.debug('Registering built-in plugins...');
    
    // This would register all built-in plugins
    // For now, we assume they're already registered via DI
    const summary = this.pluginRegistry.getPluginSummary();
    this.logger.log(`Registered ${summary.total} plugins (${summary.triggers} triggers, ${summary.events} events)`);
  }

  /**
   * Schedule periodic rule evaluation
   */
  private async scheduleRuleEvaluation(): Promise<void> {
    try {
      // Remove any existing repeatable jobs
      const repeatableJobs = await this.automationQueue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.name === AUTOMATION_JOB_NAME) {
          await this.automationQueue.removeRepeatable(job.name, { every: 60 * 1000 });
          this.logger.debug(`Removed existing repeatable job: ${job.name}`);
        }
      }

      // Add new repeatable job
      await this.automationQueue.add(
        AUTOMATION_JOB_NAME,
        {},
        {
          repeat: {
            every: 60 * 1000, // Every 1 minute
          },
          jobId: AUTOMATION_JOB_NAME,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
      
      this.logger.log('Automation rule evaluation scheduled (every 60 seconds)');
      
    } catch (error) {
      this.logger.error('Failed to schedule rule evaluation', error);
      throw error;
    }
  }

  /**
   * Gather system facts for rule evaluation
   */
  private async gatherSystemFacts(): Promise<Record<string, any>> {
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
        uptime: process.uptime(),
        nodeVersion: process.version
      }
    };
  }
}