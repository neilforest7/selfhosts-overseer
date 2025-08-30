import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { AutomationsService } from './automations.service';
import { Engine, Event } from 'json-rules-engine';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ContainersService } from '../containers/containers.service';
import { HostsService } from '../hosts/hosts.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { TriggerType } from '@prisma/client';
import { RuleJson } from './types';
import { ContextService } from '../context/context.service';

export const AUTOMATION_QUEUE_NAME = 'automation-queue';
export const AUTOMATION_JOB_NAME = 'evaluate-rules';

@Injectable()
@Processor(AUTOMATION_QUEUE_NAME)
export class AutomationsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(AutomationsProcessor.name);

  constructor(
    @InjectQueue(AUTOMATION_QUEUE_NAME) private readonly automationQueue: Queue,
    private readonly automationsService: AutomationsService,
    private readonly containersService: ContainersService,
    private readonly hostsService: HostsService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing automation processor and scheduling rule evaluation job.');
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
  }

  async process(job: Job<unknown, unknown, string>): Promise<void> {
    this.logger.debug(`Processing job: ${job.name}`);
    if (job.name === AUTOMATION_JOB_NAME) {
      await this.evaluateRules();
    }
  }

  private async evaluateRules(): Promise<void> {
    const rules = await this.automationsService.findAllEnabledRules();
    if (rules.length === 0) {
      this.logger.debug('No enabled automation rules to evaluate.');
      return;
    }
    this.logger.log(`Evaluating ${rules.length} automation rule(s)...`);

    const engine = this.createConfiguredEngine();

    rules.forEach((rule) => {
      const ruleJson = rule.ruleJson as unknown as RuleJson;
      // Attach the rule ID to the event for later reference
      const event = ruleJson.event;
      event.params = { ...event.params, __ruleId: rule.id, __ruleName: rule.name };
      engine.addRule({
        conditions: ruleJson.conditions,
        event,
      });
    });

    const facts = await this.gatherFacts();
    const { events } = await engine.run(facts);

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
    // Define dynamic facts that the engine can request
    engine.addFact('container', async (params, almanac) => {
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

  private async gatherFacts(): Promise<{ hosts: unknown[]; containers: unknown[] }> {
    const { items: allHosts } = await this.hostsService.list();
    const { items: allContainers } = await this.containersService.list({});
    return {
      hosts: allHosts,
      containers: allContainers,
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

  private async handleRestartContainer(params: Event['params']): Promise<void> {
    const { containerId } = params as { containerId?: string };
    if (!containerId) throw new Error('`containerId` is required for restart-container event.');
    
    const { items: containers } = await this.containersService.list({ q: containerId });
    if (!containers || containers.length === 0) throw new Error(`Container with ID/Name "${containerId}" not found.`);
    
    const targetContainer = containers[0];
    await this.containersService.restartOne({ id: targetContainer.hostId }, targetContainer.id);
  }

  private async handleDiscoverContainers(params: Event['params']): Promise<void> {
    const { hostId } = params as { hostId?: string };
    if (!hostId) throw new Error('`hostId` is required for discover-containers event.');
    await this.containersService.discover({ id: hostId });
  }
}