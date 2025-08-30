import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AUTOMATION_QUEUE_NAME } from './automations.processor';

@Injectable()
export class AutomationsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue(AUTOMATION_QUEUE_NAME) private readonly automationsQueue: Queue,
  ) {}

  async create(data: Prisma.AutomationRuleCreateInput) {
    const rule = await this.prisma.automationRule.create({ data });
    // Note: CRON scheduling is now handled through the rule engine's time fact
    // No need to create separate BullMQ jobs for CRON-based rules
    return rule;
  }

  async findAll() {
    const rules = await this.prisma.automationRule.findMany({
      include: {
        _count: {
          select: {
            operations: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Manually count errors for each rule
    const rulesWithCounts = await Promise.all(
      rules.map(async (rule) => {
        const errorCount = await this.prisma.operationLog.count({
          where: {
            automationRuleId: rule.id,
            status: 'ERROR',
          },
        });
        return {
          ...rule,
          errorCount,
        };
      }),
    );

    return rulesWithCounts;
  }

  async findOne(id: string) {
    return this.prisma.automationRule.findUnique({ where: { id } });
  }

  async update(id: string, data: Prisma.AutomationRuleUpdateInput) {
    const rule = await this.prisma.automationRule.update({ where: { id }, data });
    // Note: CRON scheduling is now handled through the rule engine's time fact
    // Clean up any old BullMQ jobs that might exist from previous implementation
    const job = await this.automationsQueue.getJob(id);
    if (job) {
      await job.remove();
    }
    return rule;
  }

  async remove(id: string) {
    const job = await this.automationsQueue.getJob(id);
    if (job) {
      await job.remove();
    }
    return this.prisma.automationRule.delete({ where: { id } });
  }

  async findAllEnabledRules() {
    return this.prisma.automationRule.findMany({
      where: { isEnabled: true },
    });
  }
}
