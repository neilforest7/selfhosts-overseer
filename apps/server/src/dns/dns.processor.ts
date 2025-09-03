import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { CronJob } from 'cron';
import { DnsService } from './dns.service';
import { DnsResolutionService } from './dns-resolution.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';
import { SettingsService } from '../settings/settings.service';

interface DnsResolutionJob {
  recordId: string;
  domain: string;
  recordType: string;
  providerId: string;
}

interface BatchDnsResolutionJob {
  recordIds: string[];
  batchSize?: number;
}

@Injectable()
@Processor('dns-resolution')
export class DnsProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(DnsProcessor.name);
  private dynamicCronJob: CronJob | null = null;
  private lastFrequencyMinutes: number = 60; // Track last known frequency

  constructor(
    @InjectQueue('dns-resolution') private dnsQueue: Queue,
    private readonly dnsService: DnsService,
    private readonly dnsResolutionService: DnsResolutionService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
    private readonly settingsService: SettingsService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    super();
  }

  async onModuleInit() {
    // Initialize dynamic cron job based on settings
    const settings = await this.settingsService.get();
    this.lastFrequencyMinutes = settings.dnsResolutionFrequencyMinutes;
    await this.updateScheduleFromSettings();
  }

  // Update the DNS resolution schedule based on current settings
  async updateScheduleFromSettings() {
    try {
      const settings = await this.settingsService.get();
      const frequencyMinutes = settings.dnsResolutionFrequencyMinutes;

      // Remove existing dynamic cron job if it exists
      if (this.dynamicCronJob) {
        this.dynamicCronJob.stop();
        try {
          this.schedulerRegistry.deleteCronJob('dynamic-dns-resolution');
        } catch (error) {
          // Job might not exist in registry, ignore error
        }
      }

      // Create new cron expression based on frequency
      let cronExpression: string;
      if (frequencyMinutes < 60) {
        // For frequencies less than 1 hour, use minute-based cron
        cronExpression = `*/${frequencyMinutes} * * * *`;
      } else {
        // For frequencies 1 hour or more, use hour-based cron
        const hours = Math.floor(frequencyMinutes / 60);
        cronExpression = `0 */${hours} * * *`;
      }

      // Create and register new cron job
      this.dynamicCronJob = new CronJob(cronExpression, () => {
        this.scheduleDnsResolutions();
      });

      this.schedulerRegistry.addCronJob('dynamic-dns-resolution', this.dynamicCronJob);
      this.dynamicCronJob.start();

      this.logger.log(`DNS resolution schedule updated: every ${frequencyMinutes} minutes (${cronExpression})`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to update DNS resolution schedule: ${errorMessage}`);
    }
  }

  // Main scheduler - called by dynamic cron job
  async scheduleDnsResolutions() {
    // Check if settings have changed and update schedule if needed
    try {
      const settings = await this.settingsService.get();
      if (settings.dnsResolutionFrequencyMinutes !== this.lastFrequencyMinutes) {
        this.logger.log(`DNS resolution frequency changed from ${this.lastFrequencyMinutes} to ${settings.dnsResolutionFrequencyMinutes} minutes, updating schedule...`);
        this.lastFrequencyMinutes = settings.dnsResolutionFrequencyMinutes;
        await this.updateScheduleFromSettings();
        return; // Skip this run, let the new schedule take over
      }
    } catch (error) {
      this.logger.warn('Failed to check DNS settings, continuing with current schedule');
    }

    const opLog = await this.operationLogService.create({
      title: 'Scheduled DNS Resolution Check',
      triggerType: 'SCHEDULE',
    });

    try {
      await this.contextService.run(opLog.id, async () => {
        this.logger.log('Checking for DNS records due for resolution...');

        const dueRecords = await this.dnsService.findDueRecords();

        if (dueRecords.length === 0) {
          this.logger.debug('No DNS records due for resolution');
          return;
        }

        this.logger.log(`Found ${dueRecords.length} DNS records due for resolution`);

      // Group records by check interval to optimize scheduling
      const recordGroups = this.groupRecordsByInterval(dueRecords);
      
      for (const [interval, records] of recordGroups.entries()) {
        // Add jobs with appropriate delay and priority
        for (const record of records) {
          const delay = this.calculateJobDelay(record.lastCheckAt, interval);
          const priority = this.calculateJobPriority(interval);
          
          await this.dnsQueue.add(
            'resolve-record',
            {
              recordId: record.id,
              domain: record.domain,
              recordType: record.recordType,
              providerId: record.providerId,
            } as DnsResolutionJob,
            {
              delay,
              priority,
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 2000,
              },
              removeOnComplete: 100,
              removeOnFail: 50,
            }
          );
        }
      }

        this.logger.log(`Scheduled ${dueRecords.length} DNS resolution jobs`);
      });

      await this.operationLogService.updateStatus(opLog.id, 'COMPLETED');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to schedule DNS resolutions: ${errorMessage}`, error instanceof Error ? error.stack : undefined);
      await this.operationLogService.updateStatus(opLog.id, 'ERROR');
    }
  }

  // Cleanup old completed jobs - runs every hour
  @Cron(CronExpression.EVERY_HOUR)
  async cleanupJobs() {
    try {
      await this.dnsQueue.clean(24 * 60 * 60 * 1000, 100, 'completed');
      await this.dnsQueue.clean(7 * 24 * 60 * 60 * 1000, 50, 'failed');
      this.logger.log('Cleaned up old DNS resolution jobs');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to cleanup DNS jobs: ${errorMessage}`);
    }
  }

  // Process individual DNS record resolution
  async process(job: Job<DnsResolutionJob | BatchDnsResolutionJob>): Promise<any> {
    const { name } = job;

    switch (name) {
      case 'resolve-record':
        return this.processResolutionJob(job as Job<DnsResolutionJob>);
      case 'batch-resolve':
        return this.processBatchResolutionJob(job as Job<BatchDnsResolutionJob>);
      default:
        throw new Error(`Unknown job type: ${name}`);
    }
  }

  private async processResolutionJob(job: Job<DnsResolutionJob>): Promise<any> {
    const { recordId, domain } = job.data;
    
    this.logger.debug(`Processing DNS resolution for record ${recordId} (${domain})`);

    try {
      const resolution = await this.dnsResolutionService.resolveRecord(recordId);
      
      this.logger.log(`Successfully resolved ${domain}: ${resolution.resolvedIp || 'No record'}`);
      
      return {
        success: true,
        recordId,
        domain,
        resolvedIp: resolution.resolvedIp,
        status: resolution.status,
        responseTime: resolution.responseTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to resolve DNS record ${recordId} (${domain}): ${errorMessage}`);
      throw error;
    }
  }

  private async processBatchResolutionJob(job: Job<BatchDnsResolutionJob>): Promise<any> {
    const { recordIds, batchSize = 10 } = job.data;
    
    this.logger.log(`Processing batch DNS resolution for ${recordIds.length} records`);

    const results: any[] = [];
    const errors: Array<{ recordId: string; error: string }> = [];

    // Process in batches to avoid overwhelming the DNS providers
    for (let i = 0; i < recordIds.length; i += batchSize) {
      const batch = recordIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (recordId) => {
        try {
          const resolution = await this.dnsResolutionService.resolveRecord(recordId);
          return { success: true, recordId, resolution };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to resolve record ${recordId}: ${errorMessage}`);
          errors.push({ recordId, error: errorMessage });
          return { success: false, recordId, error: errorMessage };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to respect rate limits
      if (i + batchSize < recordIds.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    this.logger.log(`Batch resolution completed: ${results.length} processed, ${errors.length} errors`);

    return {
      totalProcessed: results.length,
      successCount: results.filter(r => r.status === 'fulfilled').length,
      errorCount: errors.length,
      errors,
    };
  }

  // Manual trigger for immediate resolution
  async triggerResolution(recordId: string): Promise<void> {
    await this.dnsQueue.add(
      'resolve-record',
      {
        recordId,
      } as Partial<DnsResolutionJob>,
      {
        priority: 1, // High priority for manual triggers
        attempts: 1,
      }
    );
  }

  // Manual trigger for batch resolution
  async triggerBatchResolution(recordIds: string[], batchSize = 10): Promise<void> {
    await this.dnsQueue.add(
      'batch-resolve',
      {
        recordIds,
        batchSize,
      } as BatchDnsResolutionJob,
      {
        priority: 5, // Medium priority for batch operations
        attempts: 1,
      }
    );
  }

  // Public method to update schedule when settings change
  async updateSchedule(): Promise<void> {
    await this.updateScheduleFromSettings();
  }

  private groupRecordsByInterval(records: any[]): Map<number, any[]> {
    const groups = new Map<number, any[]>();
    
    for (const record of records) {
      const interval = record.checkInterval || 300;
      if (!groups.has(interval)) {
        groups.set(interval, []);
      }
      groups.get(interval)!.push(record);
    }
    
    return groups;
  }

  private calculateJobDelay(lastCheckAt: Date | null, interval: number): number {
    if (!lastCheckAt) {
      return 0; // Immediate execution for never-checked records
    }
    
    const nextCheckTime = new Date(lastCheckAt.getTime() + interval * 1000);
    const now = new Date();
    
    return Math.max(0, nextCheckTime.getTime() - now.getTime());
  }

  private calculateJobPriority(interval: number): number {
    // Shorter intervals get higher priority
    if (interval <= 60) return 1;      // 1 minute or less - highest priority
    if (interval <= 300) return 3;     // 5 minutes or less - high priority
    if (interval <= 900) return 5;     // 15 minutes or less - medium priority
    if (interval <= 3600) return 7;    // 1 hour or less - low priority
    return 10;                         // Longer intervals - lowest priority
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job, _result: any) {
    this.logger.debug(`Job ${job.id} completed successfully`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }

  @OnWorkerEvent('stalled')
  onStalled(job: Job) {
    this.logger.warn(`Job ${job.id} stalled`);
  }
}
