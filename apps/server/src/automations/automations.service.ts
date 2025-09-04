import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TriggerType } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AUTOMATION_QUEUE_NAME } from './automations.processor';
import { TestAutomationRuleDto } from './dto/test-automation-rule.dto';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';

@Injectable()
export class AutomationsService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue(AUTOMATION_QUEUE_NAME) private readonly automationsQueue: Queue,
    private operationLogService: OperationLogService,
    private contextService: ContextService,
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

  async testRule(id: string, data: TestAutomationRuleDto) {
    // Find the rule
    const rule = await this.prisma.automationRule.findUnique({
      where: { id },
    });

    if (!rule) {
      throw new Error(`Automation rule with id ${id} not found`);
    }

    // Create operation log for tracking
    const opLog = await this.operationLogService.create({
      title: `测试自动化规则: ${rule.name}`,
      triggerType: TriggerType.MANUAL,
      automationRuleId: rule.id,
      triggerContext: {
        testMode: true,
        customFacts: data.customFacts || null,
      },
    });

    // Queue the test execution as a background job
    await this.automationsQueue.add('test-automation-rule', {
      ruleId: id,
      opId: opLog.id,
      customFacts: data.customFacts,
    });

    return {
      taskId: opLog.id,
      message: `规则测试已启动: ${rule.name}`,
    };
  }
}
