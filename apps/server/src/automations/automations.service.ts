import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class AutomationsService {
  constructor(private prisma: PrismaService) {}

  async create(data: Prisma.AutomationRuleCreateInput) {
    return this.prisma.automationRule.create({ data });
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
    return this.prisma.automationRule.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.automationRule.delete({ where: { id } });
  }

  async findAllEnabledRules() {
    return this.prisma.automationRule.findMany({
      where: { isEnabled: true },
    });
  }
}
