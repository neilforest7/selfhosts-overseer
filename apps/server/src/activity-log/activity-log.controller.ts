import { Controller, Get, Query, Param, Post, Body } from '@nestjs/common';
import { ActivityLogService, ActivityLogQueryParams } from './activity-log.service';
import { ActivityLogCleanupService } from './activity-log-cleanup.service';

@Controller('api/v1/activity-logs')
export class ActivityLogController {
  constructor(
    private readonly activityLogService: ActivityLogService,
    private readonly activityLogCleanupService: ActivityLogCleanupService,
  ) {}

  @Get()
  async findMany(@Query() query: any) {
    const params: ActivityLogQueryParams = {
      category: query.category,
      resourceType: query.resourceType,
      hostId: query.hostId,
      action: query.action,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
      search: query.search,
    };

    return this.activityLogService.findMany(params);
  }

  @Get('recent')
  async getRecent(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.activityLogService.getRecent(limitNum);
  }

  @Get('stats')
  async getStats(
    @Query('hostId') hostId?: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days ? parseInt(days, 10) : undefined;
    return this.activityLogService.getStats(hostId, daysNum);
  }

  @Get('resource/:resourceType/:resourceId')
  async findByResource(
    @Param('resourceType') resourceType: string,
    @Param('resourceId') resourceId: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    return this.activityLogService.findByResource(resourceType, resourceId, limitNum);
  }

  @Post('cleanup')
  async runCleanup(@Body() body: { retentionDays?: number }) {
    return this.activityLogCleanupService.runManualCleanup(body.retentionDays);
  }

  @Get('cleanup/stats')
  async getCleanupStats() {
    return this.activityLogCleanupService.getCleanupStats();
  }
}
