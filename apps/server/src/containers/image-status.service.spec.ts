import { Test, TestingModule } from '@nestjs/testing';
import { ImageStatusService } from './image-status.service';
import { ImageUpdateStatus } from '@prisma/client';

describe('ImageStatusService', () => {
  let service: ImageStatusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ImageStatusService],
    }).compile();

    service = module.get<ImageStatusService>(ImageStatusService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeImageStatus', () => {
    it('should return UNKNOWN when containerImageId is missing', () => {
      const result = service.analyzeImageStatus(
        'sha256:container123', // containerImageDigest
        null,                  // containerImageId (missing)
        'sha256:local123',     // localImageDigest
        'sha256:local456',     // localImageId
        'sha256:remote123'     // remoteImageDigest
      );

      expect(result.status).toBe('UNKNOWN');
      expect(result.containerNeedsRestart).toBe(false);
      expect(result.imageNeedsPull).toBe(false);
    });

    it('should return UNKNOWN when localImageId is missing', () => {
      const result = service.analyzeImageStatus(
        'sha256:container123', // containerImageDigest
        'sha256:container456', // containerImageId
        'sha256:local123',     // localImageDigest
        null,                  // localImageId (missing)
        'sha256:remote123'     // remoteImageDigest
      );

      expect(result.status).toBe('UNKNOWN');
      expect(result.containerNeedsRestart).toBe(false);
      expect(result.imageNeedsPull).toBe(false);
    });

    it('should return UP_TO_DATE when container and local image IDs are the same', () => {
      const result = service.analyzeImageStatus(
        'sha256:abc123',  // containerImageDigest
        'sha256:def456',  // containerImageId
        'sha256:abc123',  // localImageDigest
        'sha256:def456',  // localImageId (same as container)
        'sha256:abc123'   // remoteImageDigest
      );

      expect(result.status).toBe('UP_TO_DATE');
      expect(result.containerNeedsRestart).toBe(false);
      expect(result.imageNeedsPull).toBe(false);
    });

    it('should return CONTAINER_OUTDATED when container image ID differs from local image ID', () => {
      const result = service.analyzeImageStatus(
        'sha256:container123', // containerImageDigest
        'sha256:old456',       // containerImageId (old)
        'sha256:local123',     // localImageDigest
        'sha256:new456',       // localImageId (new, different from container)
        'sha256:local123'      // remoteImageDigest (same as local)
      );

      expect(result.status).toBe('CONTAINER_OUTDATED');
      expect(result.containerNeedsRestart).toBe(true);
      expect(result.imageNeedsPull).toBe(false);
    });

    it('should return IMAGE_OUTDATED when container image ID equals local but local digest differs from remote', () => {
      const result = service.analyzeImageStatus(
        'sha256:same123',  // containerImageDigest
        'sha256:same456',  // containerImageId
        'sha256:same123',  // localImageDigest
        'sha256:same456',  // localImageId (same as container)
        'sha256:remote789' // remoteImageDigest (different from local)
      );

      expect(result.status).toBe('IMAGE_OUTDATED');
      expect(result.containerNeedsRestart).toBe(false);
      expect(result.imageNeedsPull).toBe(true);
    });

    it('should return BOTH_OUTDATED when container image ID differs from local and local digest differs from remote', () => {
      const result = service.analyzeImageStatus(
        'sha256:container123', // containerImageDigest
        'sha256:container456', // containerImageId (old)
        'sha256:local123',     // localImageDigest
        'sha256:local456',     // localImageId (different from container)
        'sha256:remote789'     // remoteImageDigest (different from local)
      );

      expect(result.status).toBe('BOTH_OUTDATED');
      expect(result.containerNeedsRestart).toBe(true);
      expect(result.imageNeedsPull).toBe(true);
    });

    it('should handle missing remote digest gracefully', () => {
      const result = service.analyzeImageStatus(
        'sha256:container123', // containerImageDigest
        'sha256:container456', // containerImageId (old)
        'sha256:local123',     // localImageDigest
        'sha256:local456',     // localImageId (different from container)
        null                   // remoteImageDigest (missing)
      );

      expect(result.status).toBe('CONTAINER_OUTDATED');
      expect(result.containerNeedsRestart).toBe(true);
      expect(result.imageNeedsPull).toBe(false);
    });

    it('should normalize image ID formats correctly', () => {
      // Test with different image ID formats
      const result1 = service.analyzeImageStatus(
        'sha256:abc123',       // containerImageDigest
        'sha256:def456',       // containerImageId
        'sha256:abc123',       // localImageDigest
        'def456',              // localImageId (without sha256: prefix, should be normalized)
        'sha256:abc123'        // remoteImageDigest
      );

      expect(result1.status).toBe('UP_TO_DATE');

      const result2 = service.analyzeImageStatus(
        'sha256:abc123',       // containerImageDigest
        'sha256:old456',       // containerImageId
        'sha256:def123',       // localImageDigest
        'sha256:new456',       // localImageId (different from container)
        'sha256:def123'        // remoteImageDigest
      );

      expect(result2.status).toBe('CONTAINER_OUTDATED');
    });

    it('should return error status when error is provided', () => {
      const result = service.analyzeImageStatus(
        'sha256:container123', // containerImageDigest
        'sha256:container456', // containerImageId
        'sha256:local123',     // localImageDigest
        'sha256:local456',     // localImageId
        'sha256:remote789',    // remoteImageDigest
        'Network error'        // error
      );

      expect(result.status).toBe('UNKNOWN');
      expect(result.error).toBe('Network error');
    });
  });

  describe('getStatusDisplay', () => {
    it('should return correct display for UP_TO_DATE', () => {
      const display = service.getStatusDisplay('UP_TO_DATE');

      expect(display.text).toBe('最新');
      expect(display.color).toBe('green');
      expect(display.action).toBeNull();
      expect(display.icon).toBe('✅');
    });

    it('should return correct display for CONTAINER_OUTDATED', () => {
      const display = service.getStatusDisplay('CONTAINER_OUTDATED');

      expect(display.text).toBe('容器需重启');
      expect(display.color).toBe('orange');
      expect(display.action).toBe('restart');
      expect(display.icon).toBe('🔄');
    });

    it('should return correct display for IMAGE_OUTDATED', () => {
      const display = service.getStatusDisplay('IMAGE_OUTDATED');

      expect(display.text).toBe('镜像需更新');
      expect(display.color).toBe('blue');
      expect(display.action).toBe('pull');
      expect(display.icon).toBe('📥');
    });

    it('should return correct display for BOTH_OUTDATED', () => {
      const display = service.getStatusDisplay('BOTH_OUTDATED');

      expect(display.text).toBe('需更新+重启');
      expect(display.color).toBe('red');
      expect(display.action).toBe('update');
      expect(display.icon).toBe('🔄📥');
    });
  });

  describe('needsAction', () => {
    it('should return correct action needs for each status', () => {
      expect(service.needsAction('UP_TO_DATE')).toEqual({
        needsPull: false,
        needsRestart: false,
        needsAnyAction: false
      });

      expect(service.needsAction('CONTAINER_OUTDATED')).toEqual({
        needsPull: false,
        needsRestart: true,
        needsAnyAction: true
      });

      expect(service.needsAction('IMAGE_OUTDATED')).toEqual({
        needsPull: true,
        needsRestart: false,
        needsAnyAction: true
      });

      expect(service.needsAction('BOTH_OUTDATED')).toEqual({
        needsPull: true,
        needsRestart: true,
        needsAnyAction: true
      });
    });
  });

  describe('getStatusPriority', () => {
    it('should return correct priorities', () => {
      expect(service.getStatusPriority('BOTH_OUTDATED')).toBe(4);
      expect(service.getStatusPriority('IMAGE_OUTDATED')).toBe(3);
      expect(service.getStatusPriority('CONTAINER_OUTDATED')).toBe(2);
      expect(service.getStatusPriority('UNKNOWN')).toBe(1);
      expect(service.getStatusPriority('UP_TO_DATE')).toBe(0);
    });
  });

  describe('getStatusStats', () => {
    it('should calculate correct statistics', () => {
      const statuses = [
        'UP_TO_DATE' as const,
        'CONTAINER_OUTDATED' as const,
        'IMAGE_OUTDATED' as const,
        'BOTH_OUTDATED' as const,
        'UNKNOWN' as const,
        'UP_TO_DATE' as const,
      ];

      const stats = service.getStatusStats(statuses);

      expect(stats.total).toBe(6);
      expect(stats.upToDate).toBe(2);
      expect(stats.containerOutdated).toBe(1);
      expect(stats.imageOutdated).toBe(1);
      expect(stats.bothOutdated).toBe(1);
      expect(stats.unknown).toBe(1);
      expect(stats.needsAction).toBe(3); // container + image + both
    });
  });
});
