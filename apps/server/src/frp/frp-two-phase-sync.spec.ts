import { Test, TestingModule } from '@nestjs/testing';
import { FrpService } from './frp.service';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

/**
 * Unit tests for FRP two-phase sync functionality
 * 
 * These tests verify the core two-phase sync logic:
 * 1. Parse phase: Store configs with pending status
 * 2. Link phase: Resolve dependencies and link configs
 */
describe('FRP Two-Phase Sync', () => {
  let service: FrpService;
  let prismaService: PrismaService;
  let dockerService: DockerService;

  const mockHost = {
    id: 'host-1',
    name: 'test-host',
    address: '192.168.1.100',
    sshUser: 'root',
    port: 22,
    tags: [],
    role: 'remote' as const,
    sshAuthMethod: 'privateKey' as const,
    sshPassword: null,
    sshPrivateKey: 'mock-key',
    sshPrivateKeyPassphrase: null,
    sshOptions: null,
    status: 'ONLINE' as const,
    lastOnlineAt: new Date(),
    lastOfflineAt: null,
    lastConnectivityCheck: new Date(),
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FrpService,
        {
          provide: PrismaService,
          useValue: {
            host: {
              findUnique: jest.fn(),
              findFirst: jest.fn()
            },
            frpsConfig: {
              upsert: jest.fn(),
              findFirst: jest.fn()
            },
            frpcProxy: {
              upsert: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn()
            },
            container: {
              findMany: jest.fn()
            }
          }
        },
        {
          provide: DockerService,
          useValue: {
            inspectContainers: jest.fn(),
            execShell: jest.fn()
          }
        },
        {
          provide: CryptoService,
          useValue: {
            decryptString: jest.fn().mockImplementation((str) => str)
          }
        },
        {
          provide: OperationLogService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'op-log-id' }),
            log: jest.fn(),
            updateStatus: jest.fn()
          }
        },
        {
          provide: ContextService,
          useValue: {
            getOpId: jest.fn().mockReturnValue('op-log-id'),
            run: jest.fn().mockImplementation((id, fn) => fn())
          }
        },
        {
          provide: ActivityLogService,
          useValue: {
            create: jest.fn()
          }
        }
      ]
    }).compile();

    service = module.get<FrpService>(FrpService);
    prismaService = module.get<PrismaService>(PrismaService);
    dockerService = module.get<DockerService>(DockerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Parse Phase', () => {
    it('should store FRPS config during parse phase', async () => {
      const mockContainer = {
        Id: 'frps-container-id',
        Names: ['/frps'],
        Image: 'snowdreamtech/frps:latest',
        State: 'running',
        Mounts: [
          {
            Type: 'bind',
            Source: '/opt/frp/frps.ini',
            Destination: '/etc/frp/frps.ini'
          }
        ]
      };

      const mockConfig = `
[common]
bind_port = 7000
vhost_http_port = 8080
`;

      (prismaService.host.findUnique as jest.Mock).mockResolvedValue(mockHost);
      (dockerService.inspectContainers as jest.Mock).mockResolvedValue([mockContainer]);
      (dockerService.execShell as jest.Mock).mockResolvedValue({
        code: 0,
        stdout: mockConfig,
        stderr: ''
      });
      (prismaService.frpsConfig.upsert as jest.Mock).mockResolvedValue({});

      await service.syncFrpFromHost('host-1', 'parse');

      expect(prismaService.frpsConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            hostId: 'host-1',
            containerId: 'frps-container-id',
            bindPort: 7000,
            vhostHttpPort: 8080
          })
        })
      );
    });

    it('should store FRPC proxy with pending status during parse phase', async () => {
      const mockContainer = {
        Id: 'frpc-container-id',
        Names: ['/frpc'],
        Image: 'snowdreamtech/frpc:latest',
        State: 'running',
        Mounts: [
          {
            Type: 'bind',
            Source: '/opt/frp/frpc.ini',
            Destination: '/etc/frp/frpc.ini'
          }
        ]
      };

      const mockConfig = `
[common]
server_addr = 192.168.1.100
server_port = 7000

[web]
type = http
local_ip = 127.0.0.1
local_port = 80
subdomain = web
`;

      (prismaService.host.findUnique as jest.Mock).mockResolvedValue(mockHost);
      (dockerService.inspectContainers as jest.Mock).mockResolvedValue([mockContainer]);
      (dockerService.execShell as jest.Mock).mockResolvedValue({
        code: 0,
        stdout: mockConfig,
        stderr: ''
      });
      (prismaService.frpcProxy.upsert as jest.Mock).mockResolvedValue({});

      await service.syncFrpFromHost('host-1', 'parse');

      expect(prismaService.frpcProxy.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            hostId: 'host-1',
            containerId: 'frpc-container-id',
            name: 'web',
            type: 'http',
            localIp: '127.0.0.1',
            localPort: 80,
            syncStatus: 'pending',
            pendingServerAddr: '192.168.1.100',
            pendingServerPort: 7000,
            frpsConfigId: null
          })
        })
      );
    });
  });

  describe('Link Phase', () => {
    it('should resolve dependencies and link FRPC to FRPS', async () => {
      const mockPendingProxies = [
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null,
          hostId: 'host-1',
          containerId: 'frpc-container-id'
        }
      ];

      const mockFrpsHost = {
        id: 'host-frps',
        name: 'frps-host',
        address: '192.168.1.100'
      };

      const mockFrpsConfig = {
        id: 'frps-config-id',
        hostId: 'host-frps',
        bindPort: 7000
      };

      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue(mockPendingProxies);
      (prismaService.host.findFirst as jest.Mock).mockResolvedValue(mockFrpsHost);
      (prismaService.frpsConfig.findFirst as jest.Mock).mockResolvedValue(mockFrpsConfig);
      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});

      await service.resolveFrpDependencies();

      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith({
        where: { id: 'proxy-1' },
        data: {
          frpsConfigId: 'frps-config-id',
          syncStatus: 'linked',
          lastLinkAttempt: expect.any(Date),
          linkErrorMessage: null
        }
      });
    });

    it('should mark proxy as failed when FRPS config not found', async () => {
      const mockPendingProxies = [
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null,
          hostId: 'host-1',
          containerId: 'frpc-container-id'
        }
      ];

      const mockFrpsHost = {
        id: 'host-frps',
        name: 'frps-host',
        address: '192.168.1.100'
      };

      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue(mockPendingProxies);
      (prismaService.host.findFirst as jest.Mock).mockResolvedValue(mockFrpsHost);
      (prismaService.frpsConfig.findFirst as jest.Mock).mockResolvedValue(null); // No FRPS config found
      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});

      await service.resolveFrpDependencies();

      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith({
        where: { id: 'proxy-1' },
        data: {
          syncStatus: 'failed',
          lastLinkAttempt: expect.any(Date),
          linkErrorMessage: expect.stringContaining('FRPS config not found')
        }
      });
    });

    it('should mark proxy as failed when FRPS host not found', async () => {
      const mockPendingProxies = [
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.999', // Non-existent host
          pendingServerPort: 7000,
          frpsConfigId: null,
          hostId: 'host-1',
          containerId: 'frpc-container-id'
        }
      ];

      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue(mockPendingProxies);
      (prismaService.host.findFirst as jest.Mock).mockResolvedValue(null); // No host found
      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});

      await service.resolveFrpDependencies();

      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith({
        where: { id: 'proxy-1' },
        data: {
          syncStatus: 'failed',
          lastLinkAttempt: expect.any(Date),
          linkErrorMessage: expect.stringContaining('FRPS host not found')
        }
      });
    });
  });

  describe('Validation and Health Checks', () => {
    it('should validate FRP topology and return health status', async () => {
      const mockProxies = [
        {
          id: 'proxy-1',
          syncStatus: 'linked',
          frpsConfigId: 'frps-1',
          frps: { id: 'frps-1' }
        },
        {
          id: 'proxy-2',
          syncStatus: 'pending',
          frpsConfigId: null,
          frps: null
        },
        {
          id: 'proxy-3',
          syncStatus: 'failed',
          frpsConfigId: null,
          frps: null
        }
      ];

      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue(mockProxies);

      const result = await service.validateFrpTopology();

      expect(result).toEqual({
        totalFrpcProxies: 3,
        linkedProxies: 1,
        pendingProxies: 1,
        failedProxies: 1,
        orphanedProxies: 0,
        issues: expect.arrayContaining([
          expect.stringContaining('1 FRPC proxies failed to link')
        ]),
        isHealthy: false
      });
    });

    it('should heal broken FRP relationships', async () => {
      const mockFailedProxies = [
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'failed',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        }
      ];

      const mockFrpsHost = {
        id: 'host-frps',
        name: 'frps-host',
        address: '192.168.1.100'
      };

      const mockFrpsConfig = {
        id: 'frps-config-id',
        hostId: 'host-frps',
        bindPort: 7000
      };

      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue(mockFailedProxies);
      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});
      (prismaService.host.findFirst as jest.Mock).mockResolvedValue(mockFrpsHost);
      (prismaService.frpsConfig.findFirst as jest.Mock).mockResolvedValue(mockFrpsConfig);

      const result = await service.healFrpRelationships();

      expect(result.retriedCount).toBe(1);
      expect(result.healedCount).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify proxy was reset to pending and then linked
      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith({
        where: { id: 'proxy-1' },
        data: {
          syncStatus: 'pending',
          linkErrorMessage: null,
          lastLinkAttempt: null
        }
      });

      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith({
        where: { id: 'proxy-1' },
        data: {
          frpsConfigId: 'frps-config-id',
          syncStatus: 'linked',
          lastLinkAttempt: expect.any(Date),
          linkErrorMessage: null
        }
      });
    });
  });
});
