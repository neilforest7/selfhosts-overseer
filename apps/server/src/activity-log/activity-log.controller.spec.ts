import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogService } from './activity-log.service';
import { ActivityLogCleanupService } from './activity-log-cleanup.service';

describe('ActivityLogController', () => {
  let controller: ActivityLogController;
  let activityLogService: ActivityLogService;
  let cleanupService: ActivityLogCleanupService;

  const mockActivityLogService = {
    findMany: jest.fn(),
    getRecent: jest.fn(),
    getStats: jest.fn(),
    findByResource: jest.fn(),
  };

  const mockCleanupService = {
    runManualCleanup: jest.fn(),
    getCleanupStats: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivityLogController],
      providers: [
        {
          provide: ActivityLogService,
          useValue: mockActivityLogService,
        },
        {
          provide: ActivityLogCleanupService,
          useValue: mockCleanupService,
        },
      ],
    }).compile();

    controller = module.get<ActivityLogController>(ActivityLogController);
    activityLogService = module.get<ActivityLogService>(ActivityLogService);
    cleanupService = module.get<ActivityLogCleanupService>(ActivityLogCleanupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findMany', () => {
    it('should return paginated activity logs', async () => {
      const mockResponse = {
        items: [
          { id: '1', title: 'Test 1' },
          { id: '2', title: 'Test 2' },
        ],
        total: 2,
        hasMore: false,
      };

      mockActivityLogService.findMany.mockResolvedValue(mockResponse);

      const query = {
        category: 'HOST_MANAGEMENT',
        limit: '10',
        offset: '0',
      };

      const result = await controller.findMany(query);

      expect(mockActivityLogService.findMany).toHaveBeenCalledWith({
        category: 'HOST_MANAGEMENT',
        resourceType: undefined,
        hostId: undefined,
        action: undefined,
        startDate: undefined,
        endDate: undefined,
        limit: 10,
        offset: 0,
        search: undefined,
      });

      expect(result).toEqual(mockResponse);
    });

    it('should handle date parameters correctly', async () => {
      const mockResponse = { items: [], total: 0, hasMore: false };
      mockActivityLogService.findMany.mockResolvedValue(mockResponse);

      const query = {
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2024-01-31T23:59:59Z',
      };

      await controller.findMany(query);

      expect(mockActivityLogService.findMany).toHaveBeenCalledWith({
        category: undefined,
        resourceType: undefined,
        hostId: undefined,
        action: undefined,
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-31T23:59:59Z'),
        limit: undefined,
        offset: undefined,
        search: undefined,
      });
    });
  });

  describe('getRecent', () => {
    it('should return recent activities', async () => {
      const mockActivities = [
        { id: '1', title: 'Recent 1' },
        { id: '2', title: 'Recent 2' },
      ];

      mockActivityLogService.getRecent.mockResolvedValue(mockActivities);

      const result = await controller.getRecent('5');

      expect(mockActivityLogService.getRecent).toHaveBeenCalledWith(5);
      expect(result).toEqual(mockActivities);
    });

    it('should use default limit when not provided', async () => {
      const mockActivities = [];
      mockActivityLogService.getRecent.mockResolvedValue(mockActivities);

      await controller.getRecent();

      expect(mockActivityLogService.getRecent).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getStats', () => {
    it('should return activity statistics', async () => {
      const mockStats = {
        total: 100,
        byCategory: [
          { category: 'HOST_MANAGEMENT', count: 50 },
        ],
        byAction: [
          { action: 'created', count: 30 },
        ],
      };

      mockActivityLogService.getStats.mockResolvedValue(mockStats);

      const result = await controller.getStats('host-1', '7');

      expect(mockActivityLogService.getStats).toHaveBeenCalledWith('host-1', 7);
      expect(result).toEqual(mockStats);
    });

    it('should use default parameters when not provided', async () => {
      const mockStats = { total: 0, byCategory: [], byAction: [] };
      mockActivityLogService.getStats.mockResolvedValue(mockStats);

      await controller.getStats();

      expect(mockActivityLogService.getStats).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('findByResource', () => {
    it('should return activities for a specific resource', async () => {
      const mockActivities = [
        { id: '1', title: 'Resource activity 1' },
        { id: '2', title: 'Resource activity 2' },
      ];

      mockActivityLogService.findByResource.mockResolvedValue(mockActivities);

      const result = await controller.findByResource('container', 'container-123', '10');

      expect(mockActivityLogService.findByResource).toHaveBeenCalledWith(
        'container',
        'container-123',
        10
      );
      expect(result).toEqual(mockActivities);
    });

    it('should use default limit when not provided', async () => {
      const mockActivities = [];
      mockActivityLogService.findByResource.mockResolvedValue(mockActivities);

      await controller.findByResource('host', 'host-123');

      expect(mockActivityLogService.findByResource).toHaveBeenCalledWith(
        'host',
        'host-123',
        undefined
      );
    });
  });

  describe('runCleanup', () => {
    it('should run manual cleanup with custom retention days', async () => {
      const mockResult = { count: 25, retentionDays: 14 };
      mockCleanupService.runManualCleanup.mockResolvedValue(mockResult);

      const result = await controller.runCleanup({ retentionDays: 14 });

      expect(mockCleanupService.runManualCleanup).toHaveBeenCalledWith(14);
      expect(result).toEqual(mockResult);
    });

    it('should run cleanup without retention days', async () => {
      const mockResult = { count: 30, retentionDays: 30 };
      mockCleanupService.runManualCleanup.mockResolvedValue(mockResult);

      const result = await controller.runCleanup({});

      expect(mockCleanupService.runManualCleanup).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockResult);
    });
  });

  describe('getCleanupStats', () => {
    it('should return cleanup statistics', async () => {
      const mockStats = {
        totalEntries: 1000,
        entriesOlderThan30Days: 100,
        entriesOlderThan90Days: 50,
        oldestEntry: new Date('2023-01-01'),
        newestEntry: new Date('2024-01-01'),
      };

      mockCleanupService.getCleanupStats.mockResolvedValue(mockStats);

      const result = await controller.getCleanupStats();

      expect(mockCleanupService.getCleanupStats).toHaveBeenCalled();
      expect(result).toEqual(mockStats);
    });
  });
});
