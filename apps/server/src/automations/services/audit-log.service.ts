/**
 * 自动化规则审计日志服务
 * 
 * 提供完整的更新操作审计跟踪，包括配置差异、字段变更记录等
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogEntry {
  ruleId: string;
  operationType: 'CREATE' | 'UPDATE' | 'DELETE';
  userId?: string;
  requestId?: string;
  timestamp: Date;
  
  // 更新前后的数据快照
  beforeSnapshot?: any;
  afterSnapshot?: any;
  
  // 变更详情
  changedFields: string[];
  triggersChanged: boolean;
  eventsChanged: boolean;
  notificationsChanged: boolean;
  
  // 操作结果
  success: boolean;
  errorMessage?: string;
  duration: number; // 毫秒
}

export interface ConfigDiff {
  field: string;
  oldValue: any;
  newValue: any;
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录更新操作的审计日志
   */
  async logUpdate(entry: AuditLogEntry): Promise<void> {
    try {
      // 计算配置差异
      const configDiffs = this.calculateConfigDiffs(entry.beforeSnapshot, entry.afterSnapshot);
      
      // 创建操作日志记录
      await this.prisma.operationLog.create({
        data: {
          title: `${entry.operationType}: ${entry.afterSnapshot?.name || entry.beforeSnapshot?.name || 'Unknown Rule'}`,
          status: entry.success ? 'COMPLETED' : 'ERROR',
          triggerType: 'MANUAL',
          triggerContext: {
            operationType: entry.operationType,
            userId: entry.userId,
            requestId: entry.requestId,
            changedFields: entry.changedFields,
            triggersChanged: entry.triggersChanged,
            eventsChanged: entry.eventsChanged,
            notificationsChanged: entry.notificationsChanged,
            configDiffs: JSON.parse(JSON.stringify(configDiffs)),
            duration: entry.duration
          } as any,
          context: {
            beforeSnapshot: entry.beforeSnapshot,
            afterSnapshot: entry.afterSnapshot
          },
          startTime: entry.timestamp,
          endTime: new Date(entry.timestamp.getTime() + entry.duration),
          automationRuleId: entry.ruleId
        }
      });

      this.logger.log(`Audit log created for ${entry.operationType} operation on rule ${entry.ruleId}`);

    } catch (error) {
      this.logger.error(`Failed to create audit log for rule ${entry.ruleId}:`, error);
      // 不抛出错误，避免影响主要操作
    }
  }

  /**
   * 获取规则的审计历史
   */
  async getAuditHistory(ruleId: string, limit: number = 50): Promise<any[]> {
    return await this.prisma.operationLog.findMany({
      where: {
        automationRuleId: ruleId,
        title: {
          contains: 'UPDATE:'
        }
      },
      orderBy: { startTime: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        startTime: true,
        endTime: true,
        triggerContext: true,
        context: true
      }
    });
  }

  /**
   * 计算配置差异
   */
  private calculateConfigDiffs(before: any, after: any): ConfigDiff[] {
    const diffs: ConfigDiff[] = [];

    if (!before && !after) return diffs;

    // 处理基础字段差异
    const basicFields = ['name', 'description', 'isEnabled', 'priority', 'category', 'tags'];
    
    for (const field of basicFields) {
      const oldValue = before?.[field];
      const newValue = after?.[field];
      
      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        let changeType: 'ADDED' | 'REMOVED' | 'MODIFIED' = 'MODIFIED';
        
        if (oldValue === undefined && newValue !== undefined) {
          changeType = 'ADDED';
        } else if (oldValue !== undefined && newValue === undefined) {
          changeType = 'REMOVED';
        }
        
        diffs.push({
          field,
          oldValue,
          newValue,
          changeType
        });
      }
    }

    // 处理触发器差异
    const triggerDiffs = this.compareArrays(before?.triggers || [], after?.triggers || [], 'triggers');
    diffs.push(...triggerDiffs);

    // 处理事件差异
    const eventDiffs = this.compareArrays(before?.events || [], after?.events || [], 'events');
    diffs.push(...eventDiffs);

    // 处理通知差异
    const notificationDiffs = this.compareArrays(before?.notifications || [], after?.notifications || [], 'notifications');
    diffs.push(...notificationDiffs);

    return diffs;
  }

  /**
   * 比较数组差异
   */
  private compareArrays(oldArray: any[], newArray: any[], fieldName: string): ConfigDiff[] {
    const diffs: ConfigDiff[] = [];

    // 简化比较：如果数组长度或内容不同，记录为整体变更
    if (JSON.stringify(oldArray) !== JSON.stringify(newArray)) {
      diffs.push({
        field: fieldName,
        oldValue: oldArray,
        newValue: newArray,
        changeType: 'MODIFIED'
      });

      // 详细比较每个元素的配置
      for (let i = 0; i < Math.max(oldArray.length, newArray.length); i++) {
        const oldItem = oldArray[i];
        const newItem = newArray[i];

        if (!oldItem && newItem) {
          diffs.push({
            field: `${fieldName}[${i}]`,
            oldValue: undefined,
            newValue: newItem,
            changeType: 'ADDED'
          });
        } else if (oldItem && !newItem) {
          diffs.push({
            field: `${fieldName}[${i}]`,
            oldValue: oldItem,
            newValue: undefined,
            changeType: 'REMOVED'
          });
        } else if (oldItem && newItem && JSON.stringify(oldItem) !== JSON.stringify(newItem)) {
          // 比较配置字段
          if (fieldName === 'triggers' && oldItem.config !== newItem.config) {
            diffs.push({
              field: `${fieldName}[${i}].config`,
              oldValue: oldItem.config,
              newValue: newItem.config,
              changeType: 'MODIFIED'
            });
          }
          
          if (fieldName === 'events' && oldItem.params !== newItem.params) {
            diffs.push({
              field: `${fieldName}[${i}].params`,
              oldValue: oldItem.params,
              newValue: newItem.params,
              changeType: 'MODIFIED'
            });
          }
        }
      }
    }

    return diffs;
  }

  /**
   * 创建规则版本快照
   */
  async createVersionSnapshot(ruleId: string, version: string, data: any): Promise<void> {
    try {
      // 使用操作日志表存储版本快照
      await this.prisma.operationLog.create({
        data: {
          title: `Version Snapshot: ${data.name} (v${version})`,
          status: 'COMPLETED',
          triggerType: 'MANUAL',
          triggerContext: {
            operationType: 'VERSION_SNAPSHOT',
            version: version,
            snapshotType: 'MANUAL'
          },
          context: {
            ruleSnapshot: data,
            version: version,
            createdAt: new Date()
          },
          automationRuleId: ruleId
        }
      });

      this.logger.log(`Version snapshot created for rule ${ruleId}, version ${version}`);

    } catch (error) {
      this.logger.error(`Failed to create version snapshot for rule ${ruleId}:`, error);
    }
  }

  /**
   * 获取规则的版本历史
   */
  async getVersionHistory(ruleId: string): Promise<any[]> {
    return await this.prisma.operationLog.findMany({
      where: {
        automationRuleId: ruleId,
        triggerContext: {
          path: ['operationType'],
          equals: 'VERSION_SNAPSHOT'
        }
      },
      orderBy: { startTime: 'desc' },
      select: {
        id: true,
        title: true,
        startTime: true,
        triggerContext: true,
        context: true
      }
    });
  }

  /**
   * 根据版本快照恢复规则配置
   */
  async getVersionSnapshot(ruleId: string, snapshotId: string): Promise<any | null> {
    const snapshot = await this.prisma.operationLog.findFirst({
      where: {
        id: snapshotId,
        automationRuleId: ruleId,
        title: {
          contains: 'Version Snapshot:'
        }
      },
      select: {
        context: true,
        triggerContext: true
      }
    });

    const context = snapshot?.context as any;
    return context?.ruleSnapshot || null;
  }

  /**
   * 清理旧的审计日志（保留指定天数）
   */
  async cleanupOldLogs(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.prisma.operationLog.deleteMany({
      where: {
        startTime: {
          lt: cutoffDate
        },
        OR: [
          { title: { contains: 'UPDATE:' } },
          { title: { contains: 'CREATE:' } },
          { title: { contains: 'DELETE:' } },
          { title: { contains: 'Version Snapshot:' } }
        ]
      }
    });

    this.logger.log(`Cleaned up ${result.count} old audit log entries`);
    return result.count;
  }
}
