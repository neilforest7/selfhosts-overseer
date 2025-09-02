import { Test, TestingModule } from '@nestjs/testing';
import { ConnectivityService } from './connectivity.service';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { HostStatus } from '@prisma/client';

describe('ConnectivityService', () => {
  let service: ConnectivityService;
  let prismaService: jest.Mocked<PrismaService>;
  let eventEmitter: jest.Mocked<EventEmitter2>;
  let activityLogService: jest.Mocked<ActivityLogService>;

  const mockHost = {
    id: 'host-1',
    name: 'Test Host',
    address: '192.168.1.100',
    sshUser: 'root',
    port: 22,
    status: HostStatus.UNKNOWN,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectivityService,
        {
          provide: PrismaService,
          useValue: {
            host: {
              findUnique: jest.fn(),
              update: jest.fn(),
            },
            hostConnectivityCheck: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
            },
          },
        },
        {
          provide: EventEmitter2,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: ActivityLogService,
          useValue: {
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ConnectivityService>(ConnectivityService);
    prismaService = module.get(PrismaService);
    eventEmitter = module.get(EventEmitter2);
    activityLogService = module.get(ActivityLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkHostConnectivity', () => {
    it('should return OFFLINE status when host is not found', async () => {
      prismaService.host.findUnique.mockResolvedValue(null);

      const result = await service.checkHostConnectivity('non-existent-host');

      expect(result.status).toBe(HostStatus.OFFLINE);
      expect(result.errorMessage).toContain('Host not found');
    });

    it('should return ONLINE status for successful connection', async () => {
      prismaService.host.findUnique.mockResolvedValue(mockHost);
      prismaService.hostConnectivityCheck.create.mockResolvedValue({} as any);
      prismaService.host.update.mockResolvedValue({} as any);

      // Mock successful SSH connection
      jest.spyOn(service as any, 'performSSHConnectivityTest').mockResolvedValue({
        success: true,
      });

      const result = await service.checkHostConnectivity('host-1');

      expect(result.status).toBe(HostStatus.ONLINE);
      expect(result.responseTime).toBeGreaterThan(0);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should return OFFLINE status for failed connection', async () => {
      prismaService.host.findUnique.mockResolvedValue(mockHost);
      prismaService.hostConnectivityCheck.create.mockResolvedValue({} as any);
      prismaService.host.update.mockResolvedValue({} as any);

      // Mock failed SSH connection
      jest.spyOn(service as any, 'performSSHConnectivityTest').mockResolvedValue({
        success: false,
        error: 'Connection timeout',
      });

      const result = await service.checkHostConnectivity('host-1');

      expect(result.status).toBe(HostStatus.OFFLINE);
      expect(result.errorMessage).toBe('Connection timeout');
    });

    it('should emit events when host status changes', async () => {
      const hostWithOfflineStatus = { ...mockHost, status: HostStatus.OFFLINE };
      prismaService.host.findUnique.mockResolvedValue(hostWithOfflineStatus);
      prismaService.hostConnectivityCheck.create.mockResolvedValue({} as any);
      prismaService.host.update.mockResolvedValue({} as any);

      // Mock successful SSH connection (host coming back online)
      jest.spyOn(service as any, 'performSSHConnectivityTest').mockResolvedValue({
        success: true,
      });

      await service.checkHostConnectivity('host-1');

      expect(eventEmitter.emit).toHaveBeenCalledWith('host.online', expect.any(Object));
      expect(eventEmitter.emit).toHaveBeenCalledWith('host.status.changed', expect.any(Object));
    });

    it('should log activity when status changes', async () => {
      const hostWithOfflineStatus = { ...mockHost, status: HostStatus.OFFLINE };
      prismaService.host.findUnique.mockResolvedValue(hostWithOfflineStatus);
      prismaService.hostConnectivityCheck.create.mockResolvedValue({} as any);
      prismaService.host.update.mockResolvedValue({} as any);

      // Mock successful SSH connection
      jest.spyOn(service as any, 'performSSHConnectivityTest').mockResolvedValue({
        success: true,
      });

      await service.checkHostConnectivity('host-1');

      expect(activityLogService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'host_online',
          resourceType: 'host',
          resourceId: 'host-1',
        })
      );
    });
  });

  describe('checkAllHostsConnectivity', () => {
    it('should check connectivity for all hosts', async () => {
      const hosts = [
        { id: 'host-1', name: 'Host 1' },
        { id: 'host-2', name: 'Host 2' },
      ];

      prismaService.host.findMany.mockResolvedValue(hosts as any);

      // Mock checkHostConnectivity method
      jest.spyOn(service, 'checkHostConnectivity').mockResolvedValue({
        hostId: 'host-1',
        status: HostStatus.ONLINE,
        responseTime: 100,
        checkedAt: new Date(),
      });

      const results = await service.checkAllHostsConnectivity();

      expect(results).toHaveLength(2);
      expect(service.checkHostConnectivity).toHaveBeenCalledTimes(2);
    });

    it('should handle errors gracefully during batch checking', async () => {
      const hosts = [
        { id: 'host-1', name: 'Host 1' },
        { id: 'host-2', name: 'Host 2' },
      ];

      prismaService.host.findMany.mockResolvedValue(hosts as any);

      // Mock one successful and one failed check
      jest.spyOn(service, 'checkHostConnectivity')
        .mockResolvedValueOnce({
          hostId: 'host-1',
          status: HostStatus.ONLINE,
          responseTime: 100,
          checkedAt: new Date(),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const results = await service.checkAllHostsConnectivity();

      expect(results).toHaveLength(2);
      expect(results[0].status).toBe(HostStatus.ONLINE);
      expect(results[1].status).toBe(HostStatus.OFFLINE);
      expect(results[1].errorMessage).toBe('Network error');
    });
  });

  describe('getConnectivityStats', () => {
    it('should return correct connectivity statistics', async () => {
      const hosts = [
        { status: HostStatus.ONLINE },
        { status: HostStatus.ONLINE },
        { status: HostStatus.OFFLINE },
        { status: HostStatus.UNKNOWN },
      ];

      const recentChecks = [
        { responseTime: 100 },
        { responseTime: 200 },
        { responseTime: 150 },
      ];

      prismaService.host.findMany.mockResolvedValue(hosts as any);
      prismaService.hostConnectivityCheck.findMany.mockResolvedValue(recentChecks as any);

      const stats = await service.getConnectivityStats();

      expect(stats.total).toBe(4);
      expect(stats.online).toBe(2);
      expect(stats.offline).toBe(1);
      expect(stats.unknown).toBe(1);
      expect(stats.averageResponseTime).toBe(150); // (100 + 200 + 150) / 3
    });

    it('should handle empty data gracefully', async () => {
      prismaService.host.findMany.mockResolvedValue([]);
      prismaService.hostConnectivityCheck.findMany.mockResolvedValue([]);

      const stats = await service.getConnectivityStats();

      expect(stats.total).toBe(0);
      expect(stats.online).toBe(0);
      expect(stats.offline).toBe(0);
      expect(stats.unknown).toBe(0);
      expect(stats.averageResponseTime).toBe(0);
    });
  });

  describe('getHostConnectivityHistory', () => {
    it('should return connectivity history for a host', async () => {
      const mockHistory = [
        {
          id: '1',
          hostId: 'host-1',
          status: HostStatus.ONLINE,
          responseTime: 100,
          checkedAt: new Date(),
        },
        {
          id: '2',
          hostId: 'host-1',
          status: HostStatus.OFFLINE,
          responseTime: null,
          checkedAt: new Date(),
        },
      ];

      prismaService.hostConnectivityCheck.findMany.mockResolvedValue(mockHistory as any);

      const history = await service.getHostConnectivityHistory('host-1', 50);

      expect(history).toHaveLength(2);
      expect(prismaService.hostConnectivityCheck.findMany).toHaveBeenCalledWith({
        where: { hostId: 'host-1' },
        orderBy: { checkedAt: 'desc' },
        take: 50,
      });
    });
  });
});
