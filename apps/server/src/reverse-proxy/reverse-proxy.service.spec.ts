import { Test, TestingModule } from '@nestjs/testing';
import { ReverseProxyService } from './reverse-proxy.service';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { SettingsService } from '../settings/settings.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';

describe('ReverseProxyService', () => {
  let service: ReverseProxyService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    reverseProxyRoute: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      upsert: jest.fn(),
    },
    container: {
      findFirst: jest.fn(),
    },
    host: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };

  const mockDockerService = {
    inspectContainers: jest.fn(),
    execShell: jest.fn(),
  };

  const mockCryptoService = {
    decryptString: jest.fn(),
  };

  const mockSettingsService = {
    get: jest.fn(),
  };

  const mockOperationLogService = {
    create: jest.fn(),
    log: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockContextService = {
    getOpId: jest.fn(),
    run: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReverseProxyService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
        {
          provide: SettingsService,
          useValue: mockSettingsService,
        },
        {
          provide: OperationLogService,
          useValue: mockOperationLogService,
        },
        {
          provide: ContextService,
          useValue: mockContextService,
        },
      ],
    }).compile();

    service = module.get<ReverseProxyService>(ReverseProxyService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cleanupOrphanedRoutes', () => {
    it('should return 0 when no orphaned routes exist', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const result = await service.cleanupOrphanedRoutes();

      expect(result.deletedCount).toBe(0);
      expect(mockPrismaService.reverseProxyRoute.deleteMany).not.toHaveBeenCalled();
    });

    it('should delete orphaned routes and return count', async () => {
      const orphanedRoutes = [
        { id: 'route1', hostId: 'missing-host-1', domain: 'example1.com' },
        { id: 'route2', hostId: 'missing-host-2', domain: 'example2.com' },
      ];

      mockPrismaService.$queryRaw.mockResolvedValue(orphanedRoutes);
      mockPrismaService.reverseProxyRoute.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.cleanupOrphanedRoutes();

      expect(result.deletedCount).toBe(2);
      expect(mockPrismaService.reverseProxyRoute.deleteMany).toHaveBeenCalledWith({
        where: {
          id: {
            in: ['route1', 'route2']
          }
        }
      });
    });

    it('should handle errors gracefully', async () => {
      const error = new Error('Database error');
      mockPrismaService.$queryRaw.mockRejectedValue(error);

      await expect(service.cleanupOrphanedRoutes()).rejects.toThrow('Database error');
    });
  });

  describe('syncAndCleanup', () => {
    it('should sync routes and then cleanup orphaned routes', async () => {
      const hostId = 'test-host-id';
      
      // Mock syncRoutesFromHost to resolve successfully
      jest.spyOn(service, 'syncRoutesFromHost').mockResolvedValue();
      jest.spyOn(service, 'cleanupOrphanedRoutes').mockResolvedValue({ deletedCount: 1 });

      await service.syncAndCleanup(hostId);

      expect(service.syncRoutesFromHost).toHaveBeenCalledWith(hostId);
      expect(service.cleanupOrphanedRoutes).toHaveBeenCalled();
    });

    it('should only cleanup when no hostId provided', async () => {
      jest.spyOn(service, 'syncRoutesFromHost').mockResolvedValue();
      jest.spyOn(service, 'cleanupOrphanedRoutes').mockResolvedValue({ deletedCount: 0 });

      await service.syncAndCleanup();

      expect(service.syncRoutesFromHost).not.toHaveBeenCalled();
      expect(service.cleanupOrphanedRoutes).toHaveBeenCalled();
    });
  });

  describe('listRoutes', () => {
    it('should list routes with optional hostId filter', async () => {
      const mockRoutes = [
        { id: 'route1', domain: 'example1.com', hostId: 'host1' },
        { id: 'route2', domain: 'example2.com', hostId: 'host1' },
      ];

      mockPrismaService.reverseProxyRoute.findMany.mockResolvedValue(mockRoutes);

      const result = await service.listRoutes({ hostId: 'host1' });

      expect(result).toEqual(mockRoutes);
      expect(mockPrismaService.reverseProxyRoute.findMany).toHaveBeenCalledWith({
        where: { hostId: 'host1' },
        orderBy: { domain: 'asc' },
        take: 500,
      });
    });

    it('should list all routes when no hostId provided', async () => {
      const mockRoutes = [
        { id: 'route1', domain: 'example1.com', hostId: 'host1' },
        { id: 'route2', domain: 'example2.com', hostId: 'host2' },
      ];

      mockPrismaService.reverseProxyRoute.findMany.mockResolvedValue(mockRoutes);

      const result = await service.listRoutes({});

      expect(result).toEqual(mockRoutes);
      expect(mockPrismaService.reverseProxyRoute.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { domain: 'asc' },
        take: 500,
      });
    });
  });
});
