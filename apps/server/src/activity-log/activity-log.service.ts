import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Define ActivityCategory enum locally
export enum ActivityCategory {
  HOST_MANAGEMENT = 'HOST_MANAGEMENT',
  CONTAINER_LIFECYCLE = 'CONTAINER_LIFECYCLE',
  CONTAINER_UPDATE = 'CONTAINER_UPDATE',
  COMPOSE_OPERATION = 'COMPOSE_OPERATION',
  FRP_CONFIGURATION = 'FRP_CONFIGURATION',
  REVERSE_PROXY = 'REVERSE_PROXY',
  SYSTEM_OPERATION = 'SYSTEM_OPERATION',
  AUTOMATION = 'AUTOMATION',
}

export interface CreateActivityLogDto {
  category: ActivityCategory;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  hostId?: string;
  hostName?: string;
  title: string;
  description?: string;
  metadata?: any;
  oldValues?: any;
  newValues?: any;
}

export interface ActivityLogQueryParams {
  category?: ActivityCategory;
  resourceType?: string;
  hostId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
  search?: string;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    if (!this.prisma) {
      this.logger.error('PrismaService is not properly injected');
      throw new Error('PrismaService is not available');
    }
  }

  /**
   * Check if values have actually changed for specific activity types
   */
  private hasActualChanges(data: CreateActivityLogDto): boolean {
    // For FRP_CONFIGURATION and REVERSE_PROXY, only log if there are actual changes
    if (data.category === 'FRP_CONFIGURATION' || data.category === 'REVERSE_PROXY') {
      // If this is a creation (no oldValues), always log
      if (!data.oldValues) {
        this.logger.debug(`Logging new ${data.category} creation: ${data.title}`);
        return true;
      }

      // If we have both old and new values, compare them
      if (data.oldValues && data.newValues) {
        const oldStr = JSON.stringify(data.oldValues);
        const newStr = JSON.stringify(data.newValues);
        const hasChanges = oldStr !== newStr;

        if (!hasChanges) {
          this.logger.debug(`Skipping ${data.category} activity - no changes detected for ${data.resourceName}`);
        } else {
          this.logger.debug(`Logging ${data.category} change for ${data.resourceName}: ${oldStr} -> ${newStr}`);
        }

        return hasChanges;
      }
    }

    // For other activity types, always log
    return true;
  }

  /**
   * Create a new activity log entry
   */
  async create(data: CreateActivityLogDto) {
    try {
      // Check if we should skip logging for unchanged values
      if (!this.hasActualChanges(data)) {
        this.logger.debug(`Skipping activity log for unchanged values: ${data.title}`);
        return null;
      }

      const activityLog = await this.prisma.activityLog.create({
        data: {
          category: data.category,
          action: data.action,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
          resourceName: data.resourceName,
          hostId: data.hostId,
          hostName: data.hostName,
          title: data.title,
          description: data.description,
          metadata: data.metadata,
          oldValues: data.oldValues,
          newValues: data.newValues,
        },
        include: {
          host: {
            select: {
              name: true,
              address: true,
            },
          },
        },
      });

      // Emit event for real-time updates
      this.eventEmitter.emit('activity-log.created', activityLog);

      this.logger.debug(`Activity log created: ${data.title}`);
      return activityLog;
    } catch (error) {
      this.logger.error(`Failed to create activity log: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw error;
    }
  }

  /**
   * Query activity logs with filtering and pagination
   */
  async findMany(params: ActivityLogQueryParams = {}) {
    const {
      category,
      resourceType,
      hostId,
      action,
      startDate,
      endDate,
      limit = 50,
      offset = 0,
      search,
    } = params;

    const where: any = {};

    if (category) where.category = category;
    if (resourceType) where.resourceType = resourceType;
    if (hostId) where.hostId = hostId;
    if (action) where.action = action;

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { resourceName: { contains: search, mode: 'insensitive' } },
        { hostName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: Math.min(limit, 100), // Cap at 100 for performance
        skip: offset,
        include: {
          host: {
            select: {
              name: true,
              address: true,
            },
          },
        },
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Get activity logs for a specific resource
   */
  async findByResource(resourceType: string, resourceId: string, limit = 20) {
    return this.prisma.activityLog.findMany({
      where: {
        resourceType,
        resourceId,
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        host: {
          select: {
            name: true,
            address: true,
          },
        },
      },
    });
  }

  /**
   * Get recent activity logs for dashboard
   */
  async getRecent(limit = 10) {
    return this.prisma.activityLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: {
        host: {
          select: {
            name: true,
            address: true,
          },
        },
      },
    });
  }

  /**
   * Get activity statistics
   */
  async getStats(hostId?: string, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const where: any = {
      timestamp: { gte: startDate },
    };

    if (hostId) where.hostId = hostId;

    const [total, byCategory, byAction] = await Promise.all([
      this.prisma.activityLog.count({ where }),
      this.prisma.activityLog.groupBy({
        by: ['category'],
        where,
        _count: { category: true },
      }),
      this.prisma.activityLog.groupBy({
        by: ['action'],
        where,
        _count: { action: true },
        orderBy: { _count: { action: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      total,
      byCategory: byCategory.map((item: any) => ({
        category: item.category,
        count: item._count.category,
      })),
      byAction: byAction.map((item: any) => ({
        action: item.action,
        count: item._count.action,
      })),
    };
  }

  /**
   * Clean up old activity logs
   */
  async cleanup(retentionDays = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await this.prisma.activityLog.deleteMany({
      where: {
        timestamp: { lt: cutoffDate },
      },
    });

    this.logger.log(`Cleaned up ${result.count} activity log entries older than ${retentionDays} days`);
    return result;
  }

  /**
   * Helper method to log host-related activities
   */
  async logHostActivity(
    action: string,
    hostId: string,
    hostName: string,
    title: string,
    description?: string,
    metadata?: any,
    oldValues?: any,
    newValues?: any,
  ) {
    return this.create({
      category: ActivityCategory.HOST_MANAGEMENT,
      action,
      resourceType: 'host',
      resourceId: hostId,
      resourceName: hostName,
      hostId,
      hostName,
      title,
      description,
      metadata,
      oldValues,
      newValues,
    });
  }

  /**
   * Helper method to log container-related activities
   */
  async logContainerActivity(
    action: string,
    containerId: string,
    containerName: string,
    hostId: string,
    hostName: string,
    title: string,
    description?: string,
    metadata?: any,
    oldValues?: any,
    newValues?: any,
  ) {
    const category = action.includes('update') || action.includes('pull') 
      ? ActivityCategory.CONTAINER_UPDATE 
      : ActivityCategory.CONTAINER_LIFECYCLE;

    return this.create({
      category,
      action,
      resourceType: 'container',
      resourceId: containerId,
      resourceName: containerName,
      hostId,
      hostName,
      title,
      description,
      metadata,
      oldValues,
      newValues,
    });
  }

  /**
   * Helper method to log compose-related activities
   */
  async logComposeActivity(
    action: string,
    project: string,
    hostId: string,
    hostName: string,
    title: string,
    description?: string,
    metadata?: any,
  ) {
    return this.create({
      category: ActivityCategory.COMPOSE_OPERATION,
      action,
      resourceType: 'compose_project',
      resourceId: `${hostId}-${project}`,
      resourceName: project,
      hostId,
      hostName,
      title,
      description,
      metadata,
    });
  }
}
