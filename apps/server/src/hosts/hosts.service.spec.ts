import { Test, TestingModule } from '@nestjs/testing';
import { HostsService } from './hosts.service';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { CryptoService } from '../security/crypto.service';

describe('HostsService', () => {
  let service: HostsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    host: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    container: {
      deleteMany: jest.fn(),
    },
    frpcProxy: {
      deleteMany: jest.fn(),
    },
    frpsConfig: {
      deleteMany: jest.fn(),
    },
    reverseProxyRoute: {
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    hostNpmConfig: {
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };

  const mockSshService = {
    executeCapture: jest.fn(),
  };

  const mockCryptoService = {
    encryptString: jest.fn(),
    decryptString: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HostsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: SshService,
          useValue: mockSshService,
        },
        {
          provide: CryptoService,
          useValue: mockCryptoService,
        },
      ],
    }).compile();

    service = module.get<HostsService>(HostsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('remove', () => {
    it('should cascade delete all related records when removing a host', async () => {
      const hostId = 'test-host-id';
      
      // Mock the transaction to execute the callback
      mockPrismaService.$transaction.mockImplementation(async (callback) => {
        return await callback(mockPrismaService);
      });

      // Mock delete operations to return counts
      mockPrismaService.container.deleteMany.mockResolvedValue({ count: 2 });
      mockPrismaService.frpcProxy.deleteMany.mockResolvedValue({ count: 1 });
      mockPrismaService.frpsConfig.deleteMany.mockResolvedValue({ count: 1 });
      mockPrismaService.reverseProxyRoute.deleteMany.mockResolvedValue({ count: 3 });
      mockPrismaService.hostNpmConfig.deleteMany.mockResolvedValue({ count: 1 });
      mockPrismaService.host.delete.mockResolvedValue({ id: hostId });

      await service.remove(hostId);

      // Verify transaction was called
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);

      // Verify all related records were deleted
      expect(mockPrismaService.container.deleteMany).toHaveBeenCalledWith({
        where: { hostId }
      });
      expect(mockPrismaService.frpcProxy.deleteMany).toHaveBeenCalledWith({
        where: { hostId }
      });
      expect(mockPrismaService.frpsConfig.deleteMany).toHaveBeenCalledWith({
        where: { hostId }
      });
      expect(mockPrismaService.reverseProxyRoute.deleteMany).toHaveBeenCalledWith({
        where: { hostId }
      });
      expect(mockPrismaService.hostNpmConfig.deleteMany).toHaveBeenCalledWith({
        where: { hostId }
      });

      // Verify host was deleted last
      expect(mockPrismaService.host.delete).toHaveBeenCalledWith({
        where: { id: hostId }
      });
    });
  });

  describe('cleanupOrphanedReverseProxyRoutes', () => {
    it('should return 0 when no orphaned routes exist', async () => {
      mockPrismaService.reverseProxyRoute.findMany.mockResolvedValue([]);

      const result = await service.cleanupOrphanedReverseProxyRoutes();

      expect(result.deletedCount).toBe(0);
      expect(mockPrismaService.reverseProxyRoute.deleteMany).not.toHaveBeenCalled();
    });

    it('should delete orphaned routes and return count', async () => {
      const orphanedRoutes = [
        { id: 'route1', hostId: 'missing-host-1', domain: 'example1.com' },
        { id: 'route2', hostId: 'missing-host-2', domain: 'example2.com' },
      ];

      mockPrismaService.reverseProxyRoute.findMany.mockResolvedValue(orphanedRoutes);
      mockPrismaService.reverseProxyRoute.deleteMany.mockResolvedValue({ count: 2 });

      const result = await service.cleanupOrphanedReverseProxyRoutes();

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
      mockPrismaService.reverseProxyRoute.findMany.mockRejectedValue(error);

      await expect(service.cleanupOrphanedReverseProxyRoutes()).rejects.toThrow('Database error');
    });
  });
});
