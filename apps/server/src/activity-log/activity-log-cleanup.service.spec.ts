import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogCleanupService } from './activity-log-cleanup.service';
import { ActivityLogService } from './activity-log.service';
import { SettingsService } from '../settings/settings.service';

describe('ActivityLogCleanupService', () => {
  let service: ActivityLogCleanupService;
  let activityLogService: ActivityLogService;
  let settingsService: SettingsService;

  const mockActivityLogService = {
    cleanup: jest.fn(),
    prisma: {
      activityLog: {
        count: jest.fn(),
        findFirst: jest.fn(),
      },
    },
  };

  const mockSettingsService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActivityLogCleanupService,
        {
          provide: ActivityLogService,
          useValue: mockActivityLogService,
        },
        {
          provide: SettingsService,
          useValue: mockSettingsService,
        },
      ],
    }).compile();

    service = module.get<ActivityLogCleanupService>(ActivityLogCleanupService);
    activityLogService = module.get<ActivityLogService>(ActivityLogService);
    settingsService = module.get<SettingsService>(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleDailyCleanup', () => {
    it('should run cleanup when enabled in settings', async () => {
      const mockSettings = {
        activityLogCleanupEnabled: true,
        activityLogRetentionDays: 30,
      };

      mockSettingsService.get.mockResolvedValue(mockSettings);
      mockActivityLogService.cleanup.mockResolvedValue({ count: 10 });

      await service.handleDailyCleanup();

      expect(mockSettingsService.get).toHaveBeenCalled();
      expect(mockActivityLogService.cleanup).toHaveBeenCalledWith(30);
    });

    it('should skip cleanup when disabled in settings', async () => {
      const mockSettings = {
        activityLogCleanupEnabled: false,
        activityLogRetentionDays: 30,
      };

      mockSettingsService.get.mockResolvedValue(mockSettings);

      await service.handleDailyCleanup();

      expect(mockSettingsService.get).toHaveBeenCalled();
      expect(mockActivityLogService.cleanup).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockSettingsService.get.mockRejectedValue(new Error('Settings error'));

      // Should not throw
      await expect(service.handleDailyCleanup()).resolves.toBeUndefined();
    });
  });

  describe('handleWeeklyStatisticsCleanup', () => {
    it('should run weekly cleanup for very old entries', async () => {
      mockActivityLogService.cleanup.mockResolvedValue({ count: 5 });

      await service.handleWeeklyStatisticsCleanup();

      expect(mockActivityLogService.cleanup).toHaveBeenCalledWith(90);
    });

    it('should handle errors gracefully', async () => {
      mockActivityLogService.cleanup.mockRejectedValue(new Error('Cleanup error'));

      // Should not throw
      await expect(service.handleWeeklyStatisticsCleanup()).resolves.toBeUndefined();
    });
  });

  describe('runManualCleanup', () => {
    it('should run manual cleanup with custom retention days', async () => {
      const mockSettings = {
        activityLogRetentionDays: 30,
      };

      mockSettingsService.get.mockResolvedValue(mockSettings);
      mockActivityLogService.cleanup.mockResolvedValue({ count: 15 });

      const result = await service.runManualCleanup(7);

      expect(mockActivityLogService.cleanup).toHaveBeenCalledWith(7);
      expect(result).toEqual({
        count: 15,
        retentionDays: 7,
      });
    });

    it('should use settings retention days when not specified', async () => {
      const mockSettings = {
        activityLogRetentionDays: 45,
      };

      mockSettingsService.get.mockResolvedValue(mockSettings);
      mockActivityLogService.cleanup.mockResolvedValue({ count: 20 });

      const result = await service.runManualCleanup();

      expect(mockActivityLogService.cleanup).toHaveBeenCalledWith(45);
      expect(result).toEqual({
        count: 20,
        retentionDays: 45,
      });
    });

    it('should throw errors for manual cleanup', async () => {
      mockSettingsService.get.mockRejectedValue(new Error('Settings error'));

      await expect(service.runManualCleanup()).rejects.toThrow('Settings error');
    });
  });

  describe('getCleanupStats', () => {
    it('should return cleanup statistics', async () => {
      const mockOldestEntry = { timestamp: new Date('2023-01-01') };
      const mockNewestEntry = { timestamp: new Date('2024-01-01') };

      mockActivityLogService.prisma.activityLog.count
        .mockResolvedValueOnce(1000) // total
        .mockResolvedValueOnce(100)  // older than 30 days
        .mockResolvedValueOnce(50);  // older than 90 days

      mockActivityLogService.prisma.activityLog.findFirst
        .mockResolvedValueOnce(mockOldestEntry)  // oldest
        .mockResolvedValueOnce(mockNewestEntry); // newest

      const result = await service.getCleanupStats();

      expect(result).toEqual({
        totalEntries: 1000,
        entriesOlderThan30Days: 100,
        entriesOlderThan90Days: 50,
        oldestEntry: mockOldestEntry.timestamp,
        newestEntry: mockNewestEntry.timestamp,
      });
    });

    it('should handle missing entries gracefully', async () => {
      mockActivityLogService.prisma.activityLog.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      mockActivityLogService.prisma.activityLog.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getCleanupStats();

      expect(result).toEqual({
        totalEntries: 0,
        entriesOlderThan30Days: 0,
        entriesOlderThan90Days: 0,
        oldestEntry: undefined,
        newestEntry: undefined,
      });
    });

    it('should throw errors for stats retrieval', async () => {
      mockActivityLogService.prisma.activityLog.count.mockRejectedValue(new Error('Database error'));

      await expect(service.getCleanupStats()).rejects.toThrow('Database error');
    });
  });
});
