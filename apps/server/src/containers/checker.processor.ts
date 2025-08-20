import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ContainersService } from './containers.service';

@Injectable()
export class ContainerCheckerProcessor {
  private readonly logger = new Logger(ContainerCheckerProcessor.name);

  constructor(private readonly prisma: PrismaService, private readonly containers: ContainersService) {}

  // 占位：每日 00:45 检查更新（后续可切到 BullMQ）
  @Cron('45 0 * * *')
  async checkUpdatesDaily(): Promise<void> {
    this.logger.log('Running daily container update check for all hosts.');
    try {
      await this.containers.checkUpdatesAny({ id: 'all' });
      this.logger.log('Daily container update check finished.');
    } catch (e) {
      this.logger.error(`Daily container update check failed: ${String(e)}`);
    }
  }

  // 每 10 分钟清理重复容器记录（同 hostId + containerId）
  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupDuplicatesJob(): Promise<void> {
    try {
      const removed = await this.containers.cleanupDuplicates('all');
      if (removed > 0) this.logger.log(`Cleanup duplicates removed: ${removed}`);
    } catch (e) {
      this.logger.warn(`Cleanup duplicates failed: ${String(e)}`);
    }
  }
}

