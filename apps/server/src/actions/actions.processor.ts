import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ActionsService } from './actions.service';
import { CronExpressionParser } from 'cron-parser';
import { TriggerType } from '@prisma/client';

@Injectable()
export class ActionsProcessor {
  private readonly logger = new Logger(ActionsProcessor.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private actionsService: ActionsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (this.isRunning) {
      this.logger.warn('Previous cron job is still running. Skipping.');
      return;
    }

    this.isRunning = true;
    this.logger.log('Checking for scheduled triggers to run...');

    try {
      const triggers = await this.prisma.trigger.findMany({
        where: {
          isEnabled: true,
          type: TriggerType.SCHEDULE,
        },
      });

      const now = new Date();

      for (const trigger of triggers) {
        try {
          const cron = (trigger.config as any)?.cron;
          if (!cron) continue;

          // We need a way to track the next run time on the trigger itself.
          // This is a simplified check. A robust implementation would store nextRunAt on the Trigger model.
          const interval = CronExpressionParser.parse(cron, { currentDate: now });
          const prevRun = interval.prev().toDate();

          if (now.getTime() - prevRun.getTime() < 60000) {
            this.logger.log(`Executing action for trigger ${trigger.id}`);
            await this.actionsService.runManually(trigger.actionId, 'SCHEDULE');
          }
        } catch (err) {
          if (err instanceof Error) {
            this.logger.error(`Failed to process trigger ${trigger.id}: ${err.message}`);
          } else {
            this.logger.error(`Failed to process trigger ${trigger.id}: ${String(err)}`);
          }
        }
      }
    } catch (error) {
      this.logger.error('Error during cron job execution:', error);
    } finally {
      this.isRunning = false;
      this.logger.log('Finished checking for scheduled triggers.');
    }
  }
}
