import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConnectivityService } from './connectivity.service';
import { SettingsService } from '../settings/settings.service';

export const CONNECTIVITY_QUEUE_NAME = 'connectivity-queue';
export const CONNECTIVITY_CHECK_JOB_NAME = 'check-all-hosts';
export const SINGLE_HOST_CHECK_JOB_NAME = 'check-single-host';

@Injectable()
@Processor(CONNECTIVITY_QUEUE_NAME)
export class ConnectivityProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(ConnectivityProcessor.name);

  constructor(
    @InjectQueue(CONNECTIVITY_QUEUE_NAME) private readonly connectivityQueue: Queue,
    private readonly connectivityService: ConnectivityService,
    private readonly settingsService: SettingsService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing connectivity processor and scheduling connectivity check job.');

    // Remove any existing repeatable jobs to prevent duplicates
    try {
      const repeatableJobs = await this.connectivityQueue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.name === CONNECTIVITY_CHECK_JOB_NAME) {
          await this.connectivityQueue.removeRepeatable(job.name, { every: 5 * 60 * 1000 });
          this.logger.debug(`Removed existing repeatable job: ${job.name}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to clean up existing repeatable jobs: ${String(error)}`);
    }

    // Get connectivity check interval from settings (default: 5 minutes)
    const checkInterval = await this.getConnectivityCheckInterval();

    await this.connectivityQueue.add(
      CONNECTIVITY_CHECK_JOB_NAME,
      {},
      {
        repeat: {
          every: checkInterval,
        },
        jobId: CONNECTIVITY_CHECK_JOB_NAME, // Use a fixed job ID to prevent duplicates
        removeOnComplete: 5, // Keep last 5 completed jobs
        removeOnFail: 10, // Keep last 10 failed jobs
      },
    );
    
    this.logger.log(`Connectivity check job scheduled successfully (interval: ${checkInterval / 1000}s).`);
  }

  async process(job: Job<any, any, string>): Promise<void> {
    this.logger.debug(`Processing connectivity job: ${job.name}`);
    
    try {
      if (job.name === CONNECTIVITY_CHECK_JOB_NAME) {
        await this.checkAllHostsConnectivity();
      } else if (job.name === SINGLE_HOST_CHECK_JOB_NAME) {
        const { hostId } = job.data;
        await this.checkSingleHostConnectivity(hostId);
      }
    } catch (error) {
      this.logger.error(`Connectivity job failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error; // Re-throw to mark job as failed
    }
  }

  /**
   * Check connectivity for all hosts
   */
  private async checkAllHostsConnectivity(): Promise<void> {
    this.logger.debug('Starting scheduled connectivity check for all hosts');
    
    const startTime = Date.now();
    const results = await this.connectivityService.checkAllHostsConnectivity();
    const duration = Date.now() - startTime;
    
    const onlineCount = results.filter(r => r.status === 'ONLINE').length;
    const offlineCount = results.filter(r => r.status === 'OFFLINE').length;
    
    this.logger.log(
      `Completed connectivity check for ${results.length} hosts in ${duration}ms. ` +
      `Online: ${onlineCount}, Offline: ${offlineCount}`
    );
  }

  /**
   * Check connectivity for a single host
   */
  private async checkSingleHostConnectivity(hostId: string): Promise<void> {
    this.logger.debug(`Starting connectivity check for host: ${hostId}`);
    
    const result = await this.connectivityService.checkHostConnectivity(hostId);
    
    this.logger.debug(
      `Connectivity check completed for host ${hostId}: ${result.status} ` +
      `(${result.responseTime}ms)`
    );
  }

  /**
   * Get connectivity check interval from settings
   */
  private async getConnectivityCheckInterval(): Promise<number> {
    try {
      const settings = await this.settingsService.get();
      const interval = settings.connectivityCheckInterval; // Already in seconds from settings
      return Math.max(interval, 60) * 1000; // Minimum 1 minute, convert to milliseconds
    } catch (error) {
      this.logger.warn(`Failed to get connectivity check interval from settings, using default: ${error}`);
      return 5 * 60 * 1000; // Default: 5 minutes
    }
  }

  /**
   * Schedule a single host connectivity check
   */
  async scheduleHostCheck(hostId: string, delay = 0): Promise<void> {
    await this.connectivityQueue.add(
      SINGLE_HOST_CHECK_JOB_NAME,
      { hostId },
      {
        delay,
        removeOnComplete: 3,
        removeOnFail: 5,
      },
    );
    
    this.logger.debug(`Scheduled connectivity check for host: ${hostId} (delay: ${delay}ms)`);
  }

  /**
   * Update the connectivity check interval
   */
  async updateCheckInterval(intervalSeconds: number): Promise<void> {
    const intervalMs = Math.max(intervalSeconds, 60) * 1000; // Minimum 1 minute
    
    // Remove existing repeatable job
    try {
      const repeatableJobs = await this.connectivityQueue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.name === CONNECTIVITY_CHECK_JOB_NAME) {
          await this.connectivityQueue.removeRepeatable(job.name, { every: job.every ? Number(job.every) : undefined });
          this.logger.debug(`Removed existing repeatable job for interval update`);
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to remove existing repeatable job: ${String(error)}`);
    }

    // Add new repeatable job with updated interval
    await this.connectivityQueue.add(
      CONNECTIVITY_CHECK_JOB_NAME,
      {},
      {
        repeat: {
          every: intervalMs,
        },
        jobId: CONNECTIVITY_CHECK_JOB_NAME,
        removeOnComplete: 5,
        removeOnFail: 10,
      },
    );
    
    this.logger.log(`Updated connectivity check interval to ${intervalSeconds} seconds`);
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.connectivityQueue.getWaiting(),
      this.connectivityQueue.getActive(),
      this.connectivityQueue.getCompleted(),
      this.connectivityQueue.getFailed(),
      this.connectivityQueue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
    };
  }
}
