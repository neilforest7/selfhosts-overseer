import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Engine, Event } from 'json-rules-engine';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ContainersService } from '../containers/containers.service';
import { HostsService } from '../hosts/hosts.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { TriggerType } from '@prisma/client';
import { RuleJson } from './types';
import { ContextService } from '../context/context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CronExpressionParser } from 'cron-parser';

export const AUTOMATION_QUEUE_NAME = 'automation-queue';
export const AUTOMATION_JOB_NAME = 'evaluate-rules';

@Injectable()
@Processor(AUTOMATION_QUEUE_NAME)
export class AutomationsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AutomationsProcessor.name);

  constructor(
    @InjectQueue(AUTOMATION_QUEUE_NAME) private readonly automationQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly containersService: ContainersService,
    private readonly hostsService: HostsService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing automation processor and scheduling rule evaluation job.');

    // Remove any existing repeatable jobs to prevent duplicates
    try {
      const repeatableJobs = await this.automationQueue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.name === AUTOMATION_JOB_NAME) {
          await this.automationQueue.removeRepeatable(job.name, { every: 60 * 1000 });
          this.logger.debug(`Removed existing repeatable job: ${job.name}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to clean up existing repeatable jobs: ${String(error)}`);
    }

    await this.automationQueue.add(
      AUTOMATION_JOB_NAME,
      {},
      {
        repeat: {
          every: 60 * 1000, // Every 1 minute
        },
        jobId: AUTOMATION_JOB_NAME, // Use a fixed job ID to prevent duplicates
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    this.logger.log('Automation rule evaluation job scheduled successfully.');
  }

  async process(job: Job<any, any, string>): Promise<void> {
    this.logger.debug(`Processing job: ${job.name}`);
    if (job.name === AUTOMATION_JOB_NAME) {
      await this.evaluateRules();
    } else if (job.name === 'automation-rule') {
      const { ruleId } = job.data;
      await this.executeRule(ruleId);
    }
  }

  private async executeRule(ruleId: string): Promise<void> {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id: ruleId },
    });
    if (!rule || !rule.isEnabled) {
      this.logger.warn(`Rule ${ruleId} not found or is disabled.`);
      return;
    }

    this.logger.log(`Executing rule: ${rule.name}`);

    const engine = this.createConfiguredEngine();
    const ruleJson = rule.ruleJson as unknown as RuleJson;
    const event = ruleJson.event;
    event.params = { ...event.params, __ruleId: rule.id, __ruleName: rule.name };
    engine.addRule({
      conditions: ruleJson.conditions,
      event,
    });

    const facts = await this.gatherFacts();
    const { events } = await engine.run(facts);

    if (events.length > 0) {
      this.logger.log(`Triggered ${events.length} automation event(s) for rule ${rule.name}.`);
      for (const event of events) {
        await this.handleEvent(event);
      }
    } else {
      this.logger.debug(`Rule ${rule.name} did not trigger any events.`);
    }
  }

  private async evaluateRules(): Promise<void> {
    const rules = await this.prisma.automationRule.findMany({
      where: { isEnabled: true },
    });
    if (rules.length === 0) {
      this.logger.debug('No enabled automation rules to evaluate.');
      return;
    }
    this.logger.log(`Evaluating ${rules.length} automation rule(s)...`);

    const engine = this.createConfiguredEngine();

    rules.forEach((rule) => {
      const ruleJson = rule.ruleJson as unknown as RuleJson;
      this.logger.debug(`Adding rule "${rule.name}" (${rule.id}) to engine: ${JSON.stringify(ruleJson)}`);

      // Attach the rule ID to the event for later reference
      const event = ruleJson.event;
      event.params = { ...event.params, __ruleId: rule.id, __ruleName: rule.name };
      engine.addRule({
        conditions: ruleJson.conditions,
        event,
      });
    });

    const facts = await this.gatherFacts();
    // this.logger.debug(`Gathered facts: ${JSON.stringify(facts)}`);

    const { events } = await engine.run(facts);
    this.logger.debug(`Engine run completed, ${events.length} events triggered`);

    if (events.length > 0) {
      this.logger.log(`Triggered ${events.length} automation event(s).`);
      for (const event of events) {
        await this.handleEvent(event);
      }
    } else {
      this.logger.debug('No automation events were triggered.');
    }
  }

  private createConfiguredEngine(): Engine {
    const engine = new Engine();

    // Add time fact for CRON-based scheduling
    engine.addFact('time', async () => {
      const now = new Date();
      return {
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.getDay(), // 0 = Sunday, 1 = Monday, etc.
        dayOfMonth: now.getDate(),
        month: now.getMonth() + 1, // 1-12
        year: now.getFullYear(),
        timestamp: now.getTime(),
        iso: now.toISOString()
      };
    });

    // Add time-schedule fact (alias for time) for backward compatibility
    engine.addFact('time-schedule', async () => {
      const now = new Date();
      return {
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.getDay(), // 0 = Sunday, 1 = Monday, etc.
        dayOfMonth: now.getDate(),
        month: now.getMonth() + 1, // 1-12
        year: now.getFullYear(),
        timestamp: now.getTime(),
        iso: now.toISOString()
      };
    });

    // Add CRON matching operator
    engine.addOperator('matchesCron', (_factValue: any, jsonValue: string) => {
      try {
        const interval = CronExpressionParser.parse(jsonValue);
        const now = new Date();
        const prevRun = interval.prev().toDate();

        // Check if current time is within 1 minute of the scheduled time
        // This accounts for the 1-minute evaluation interval
        const timeDiff = Math.abs(now.getTime() - prevRun.getTime());
        const matches = timeDiff < 60000; // 60 seconds

        this.logger.debug(`CRON match check: expression="${jsonValue}", now=${now.toISOString()}, prevRun=${prevRun.toISOString()}, timeDiff=${timeDiff}ms, matches=${matches}`);

        return matches;
      } catch (error) {
        this.logger.error(`Invalid CRON expression: ${jsonValue}`, error);
        return false;
      }
    });

    // Define dynamic facts that the engine can request
    engine.addFact('container', async (params) => {
      const { name, id } = params as { name?: string; id?: string };
      if (!name && !id) {
        throw new Error('`container` fact requires a `name` or `id` parameter.');
      }
      const query = name ? { q: name } : { q: id }; // Using q for broader search
      const { items } = await this.containersService.list(query);
      return items.length > 0 ? items[0] : undefined;
    });
    return engine;
  }

  private async gatherFacts(): Promise<{ hosts: unknown[]; containers: unknown[]; time: any }> {
    const { items: allHosts } = await this.hostsService.list();
    const { items: allContainers } = await this.containersService.list({});

    // Add time fact for CRON-based rules
    const now = new Date();
    const timeFact = {
      hour: now.getHours(),
      minute: now.getMinutes(),
      dayOfWeek: now.getDay(), // 0 = Sunday, 1 = Monday, etc.
      dayOfMonth: now.getDate(),
      month: now.getMonth() + 1, // 1-12
      year: now.getFullYear(),
      timestamp: now.getTime(),
      iso: now.toISOString()
    };

    return {
      hosts: allHosts,
      containers: allContainers,
      time: timeFact,
    };
  }

  private async handleEvent(event: Event): Promise<void> {
    const { type, params } = event;
    const ruleId = params?.__ruleId as string;
    const ruleName = (params?.__ruleName as string) || 'Unknown Rule';
    this.logger.log(`Handling event "${type}" from rule "${ruleName}" (${ruleId})`);

    const opLog = await this.operationLogService.create({
      title: `Automation: ${ruleName}`,
      triggerType: TriggerType.EVENT,
      automationRuleId: ruleId,
      triggerContext: event as unknown as any,
    });

    return this.contextService.run(opLog.id, async () => {
      let isFailed = false;
      try {
        switch (type) {
          case 'log-message':
            await this.handleLogMessage(params);
            break;

          case 'restart-container':
            await this.handleRestartContainer(params);
            break;

          case 'discover-containers':
            await this.handleDiscoverContainers(params);
            break;

          default:
            this.logger.warn(`No handler found for event type "${type}".`);
            this.operationLogService.log('error', `No handler found for event type "${type}".`);
            isFailed = true;
        }
      } catch (error) {
        isFailed = true;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Error handling event "${type}" for rule "${ruleName}": ${errorMessage}`, (error as Error).stack);
        this.operationLogService.log('error', errorMessage);
      } finally {
        await this.operationLogService.updateStatus(opLog.id, isFailed ? 'ERROR' : 'COMPLETED');
      }
    });
  }

  private async handleLogMessage(params: Event['params']): Promise<void> {
    const { message } = params as { message?: string };
    if (!message) throw new Error('`message` is required for log-message event.');
    this.logger.log(`Automation Log: ${message}`);
    this.operationLogService.log('info', message);
  }

  private async handleRestartContainer(params: Event['params']): Promise<void> {
    const { containerId } = params as { containerId?: string };
    if (!containerId) throw new Error('`containerId` is required for restart-container event.');

    this.operationLogService.log('info', `Looking for container: ${containerId}`);

    const { items: containers } = await this.containersService.list({ q: containerId });
    if (!containers || containers.length === 0) throw new Error(`Container with ID/Name "${containerId}" not found.`);

    const targetContainer = containers[0];
    this.operationLogService.log('info', `Found container "${targetContainer.name}" on host ${targetContainer.hostId}, restarting...`);

    try {
      await this.containersService.restartOne({ id: targetContainer.hostId }, targetContainer.id);
      this.operationLogService.log('info', `Container "${targetContainer.name}" restarted successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Failed to restart container "${targetContainer.name}": ${errorMessage}`);
      throw error; // Re-throw to maintain error handling flow
    }
  }

  private async handleDiscoverContainers(params: Event['params']): Promise<void> {
    const { hostId, hostIds } = params as { hostId?: string; hostIds?: string[] };

    // Support both single host (legacy) and multiple hosts (new)
    if (hostIds && hostIds.length > 0) {
      // Multiple hosts
      this.operationLogService.log('info', `Starting container discovery for ${hostIds.length} hosts: ${hostIds.join(', ')}`);

      try {
        await this.containersService.discoverMultiple(hostIds);
        this.operationLogService.log('info', `Container discovery completed successfully for ${hostIds.length} hosts`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.operationLogService.log('error', `Container discovery failed for multiple hosts: ${errorMessage}`);
        throw error; // Re-throw to maintain error handling flow
      }
    } else if (hostId) {
      // Single host (legacy support)
      this.operationLogService.log('info', `Starting container discovery for host: ${hostId}`);

      try {
        await this.containersService.discover({ id: hostId });
        this.operationLogService.log('info', `Container discovery completed successfully for host: ${hostId}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.operationLogService.log('error', `Container discovery failed for host ${hostId}: ${errorMessage}`);
        throw error; // Re-throw to maintain error handling flow
      }
    } else {
      throw new Error('Either `hostId` or `hostIds` is required for discover-containers event.');
    }
  }
}