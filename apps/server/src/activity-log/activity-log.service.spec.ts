import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogService } from './activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityCategory } from '@prisma/client';

describe('ActivityLogService', () => {
  let service: ActivityLogService;
  let prismaService: PrismaService;
  let eventEmitter: EventEmitter2;

  const mockPrismaService = {
    activityLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      groupBy: jest.fn(),
    },
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityLogService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<ActivityLogService>(ActivityLogService);
    prismaService = module.get<PrismaService>(PrismaService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create an activity log entry', async () => {
      const mockActivityLog = {
        id: 'test-id',
        category: ActivityCategory.HOST_MANAGEMENT,
        action: 'created',
        resourceType: 'host',
        title: 'Test activity',
        timestamp: new Date(),
        host: { name: 'test-host', address: '192.168.1.1' },
      };

      mockPrismaService.activityLog.create.mockResolvedValue(mockActivityLog);

      const result = await service.create({
        category: ActivityCategory.HOST_MANAGEMENT,
        action: 'created',
        resourceType: 'host',
        title: 'Test activity',
      });

      expect(mockPrismaService.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: ActivityCategory.HOST_MANAGEMENT,
          action: 'created',
          resourceType: 'host',
          title: 'Test activity',
        }),
        include: {
          host: {
            select: {
              name: true,
              address: true,
            },
          },
        },
      });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith('activity-log.created', mockActivityLog);
      expect(result).toEqual(mockActivityLog);
    });

    it('should handle errors gracefully', async () => {
      mockPrismaService.activityLog.create.mockRejectedValue(new Error('Database error'));

      await expect(
        service.create({
          category: ActivityCategory.HOST_MANAGEMENT,
          action: 'created',
          resourceType: 'host',
          title: 'Test activity',
        })
      ).rejects.toThrow('Database error');
    });
  });

  describe('findMany', () => {
    it('should return paginated activity logs', async () => {
      const mockActivities = [
        {
          id: 'test-1',
          category: ActivityCategory.HOST_MANAGEMENT,
          action: 'created',
          title: 'Test 1',
        },
        {
          id: 'test-2',
          category: ActivityCategory.CONTAINER_LIFECYCLE,
          action: 'started',
          title: 'Test 2',
        },
      ];

      mockPrismaService.activityLog.findMany.mockResolvedValue(mockActivities);
      mockPrismaService.activityLog.count.mockResolvedValue(2);

      const result = await service.findMany({
        limit: 10,
        offset: 0,
      });

      expect(result).toEqual({
        items: mockActivities,
        total: 2,
        hasMore: false,
      });
    });

    it('should apply filters correctly', async () => {
      mockPrismaService.activityLog.findMany.mockResolvedValue([]);
      mockPrismaService.activityLog.count.mockResolvedValue(0);

      await service.findMany({
        category: ActivityCategory.HOST_MANAGEMENT,
        hostId: 'test-host-id',
        search: 'test search',
      });

      expect(mockPrismaService.activityLog.findMany).toHaveBeenCalledWith({
        where: {
          category: ActivityCategory.HOST_MANAGEMENT,
          hostId: 'test-host-id',
          OR: [
            { title: { contains: 'test search', mode: 'insensitive' } },
            { description: { contains: 'test search', mode: 'insensitive' } },
            { resourceName: { contains: 'test search', mode: 'insensitive' } },
            { hostName: { contains: 'test search', mode: 'insensitive' } },
          ],
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
        skip: 0,
        include: {
          host: {
            select: {
              name: true,
              address: true,
            },
          },
        },
      });
    });
  });

  describe('cleanup', () => {
    it('should delete old activity logs', async () => {
      const mockResult = { count: 5 };
      mockPrismaService.activityLog.deleteMany.mockResolvedValue(mockResult);

      const result = await service.cleanup(30);

      expect(mockPrismaService.activityLog.deleteMany).toHaveBeenCalledWith({
        where: {
          timestamp: { lt: expect.any(Date) },
        },
      });

      expect(result).toEqual(mockResult);
    });
  });

  describe('helper methods', () => {
    it('should log host activity correctly', async () => {
      const mockActivityLog = {
        id: 'test-id',
        category: ActivityCategory.HOST_MANAGEMENT,
        action: 'created',
        title: 'Host created',
      };

      mockPrismaService.activityLog.create.mockResolvedValue(mockActivityLog);

      await service.logHostActivity(
        'created',
        'host-id',
        'test-host',
        'Host created',
        'Test description'
      );

      expect(mockPrismaService.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: ActivityCategory.HOST_MANAGEMENT,
          action: 'created',
          resourceType: 'host',
          resourceId: 'host-id',
          resourceName: 'test-host',
          hostId: 'host-id',
          hostName: 'test-host',
          title: 'Host created',
          description: 'Test description',
        }),
        include: expect.any(Object),
      });
    });

    it('should log container activity correctly', async () => {
      const mockActivityLog = {
        id: 'test-id',
        category: ActivityCategory.CONTAINER_LIFECYCLE,
        action: 'started',
        title: 'Container started',
      };

      mockPrismaService.activityLog.create.mockResolvedValue(mockActivityLog);

      await service.logContainerActivity(
        'started',
        'container-id',
        'test-container',
        'host-id',
        'test-host',
        'Container started'
      );

      expect(mockPrismaService.activityLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          category: ActivityCategory.CONTAINER_LIFECYCLE,
          action: 'started',
          resourceType: 'container',
          resourceId: 'container-id',
          resourceName: 'test-container',
          hostId: 'host-id',
          hostName: 'test-host',
          title: 'Container started',
        }),
        include: expect.any(Object),
      });
    });
  });

  describe('getStats', () => {
    it('should return activity statistics', async () => {
      mockPrismaService.activityLog.count.mockResolvedValue(100);
      mockPrismaService.activityLog.groupBy
        .mockResolvedValueOnce([
          { category: ActivityCategory.HOST_MANAGEMENT, _count: { category: 50 } },
          { category: ActivityCategory.CONTAINER_LIFECYCLE, _count: { category: 30 } },
        ])
        .mockResolvedValueOnce([
          { action: 'created', _count: { action: 40 } },
          { action: 'updated', _count: { action: 35 } },
        ]);

      const result = await service.getStats();

      expect(result).toEqual({
        total: 100,
        byCategory: [
          { category: ActivityCategory.HOST_MANAGEMENT, count: 50 },
          { category: ActivityCategory.CONTAINER_LIFECYCLE, count: 30 },
        ],
        byAction: [
          { action: 'created', count: 40 },
          { action: 'updated', count: 35 },
        ],
      });
    });
  });
});
