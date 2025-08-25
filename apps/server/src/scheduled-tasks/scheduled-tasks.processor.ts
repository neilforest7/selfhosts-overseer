import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ScheduledTasksService } from './scheduled-tasks.service';
import * as parser from 'cron-parser';

@Injectable()
export class ScheduledTasksProcessor {
  private readonly logger = new Logger(ScheduledTasksProcessor.name);
  private isRunning = false;

  constructor(
    private prisma: PrismaService,
    private scheduledTasksService: ScheduledTasksService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    if (this.isRunning) {
      this.logger.warn('Previous cron job is still running. Skipping.');
      return;
    }

    this.isRunning = true;
    this.logger.log('Checking for scheduled tasks to run...');

    try {
      const tasks = await this.prisma.scheduledTask.findMany({
        where: { isEnabled: true },
      });

      const now = new Date();

      for (const task of tasks) {
        try {
          const interval = parser.parseExpression(task.cron, { currentDate: task.nextRunAt || now });
          const nextRun = interval.next().toDate();

          if (!task.nextRunAt || nextRun <= now) {
            this.logger.log(`Running scheduled task: ${task.name}`);
            await this.scheduledTasksService.runManually(task.id);
            
            const nextInterval = parser.parseExpression(task.cron);
            const nextRunTime = nextInterval.next().toDate();
            
            await this.prisma.scheduledTask.update({
              where: { id: task.id },
              data: { 
                lastRunAt: new Date(),
                nextRunAt: nextRunTime,
              },
            });
          }
        } catch (err) {
          this.logger.error(`Failed to process task ${task.name}: ${err.message}`);
        }
      }
    } catch (error) {
      this.logger.error('Error during cron job execution:', error);
    } finally {
      this.isRunning = false;
      this.logger.log('Finished checking for scheduled tasks.');
    }
  }
}
