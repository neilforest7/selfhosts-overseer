import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { FrpService } from './frp.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';
import { ActivityLogService } from '../activity-log/activity-log.service';

/**
 * Integration tests for FRP discovery order independence
 * 
 * These tests verify that the two-phase FRP sync system works correctly
 * regardless of the order in which hosts are discovered.
 */
describe('FRP Discovery Order Integration Tests', () => {
  let module: TestingModule;
  let frpService: FrpService;
  let prismaService: PrismaService;
  let dockerService: DockerService;

  // Test data setup
  const mockHosts = [
    {
      id: 'host-frps',
      name: 'frps-server',
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
    },
    {
      id: 'host-frpc-1',
      name: 'frpc-client-1',
      address: '192.168.1.101',
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
    },
    {
      id: 'host-frpc-2',
      name: 'frpc-client-2',
      address: '192.168.1.102',
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
    }
  ];

  const mockFrpsContainer = {
    Id: 'frps-container-id',
    Names: ['/frps'],
    Image: 'snowdreamtech/frps:latest',
    State: 'running',
    Status: 'Up 2 hours',
    Ports: [{ PrivatePort: 7000, PublicPort: 7000, Type: 'tcp' }],
    Mounts: [
      {
        Type: 'bind',
        Source: '/opt/frp/frps.ini',
        Destination: '/etc/frp/frps.ini'
      }
    ]
  };

  const mockFrpcContainer1 = {
    Id: 'frpc-container-1-id',
    Names: ['/frpc-web'],
    Image: 'snowdreamtech/frpc:latest',
    State: 'running',
    Status: 'Up 1 hour',
    Ports: [],
    Mounts: [
      {
        Type: 'bind',
        Source: '/opt/frp/frpc.ini',
        Destination: '/etc/frp/frpc.ini'
      }
    ]
  };

  const mockFrpcContainer2 = {
    Id: 'frpc-container-2-id',
    Names: ['/frpc-ssh'],
    Image: 'snowdreamtech/frpc:latest',
    State: 'running',
    Status: 'Up 30 minutes',
    Ports: [],
    Mounts: [
      {
        Type: 'bind',
        Source: '/opt/frp/frpc.ini',
        Destination: '/etc/frp/frpc.ini'
      }
    ]
  };

  const mockFrpsConfig = `
[common]
bind_port = 7000
vhost_http_port = 8080
vhost_https_port = 8443
subdomain_host = example.com
`;

  const mockFrpcConfig1 = `
[common]
server_addr = 192.168.1.100
server_port = 7000

[web]
type = http
local_ip = 127.0.0.1
local_port = 80
subdomain = web
`;

  const mockFrpcConfig2 = `
[common]
server_addr = 192.168.1.100
server_port = 7000

[ssh]
type = tcp
local_ip = 127.0.0.1
local_port = 22
remote_port = 2222
`;

  beforeEach(async () => {
    module = await Test.createTestingModule({
      providers: [
        FrpService,
        {
          provide: PrismaService,
          useValue: {
            host: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn()
            },
            frpsConfig: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              upsert: jest.fn(),
              count: jest.fn()
            },
            frpcProxy: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn()
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

    frpService = module.get<FrpService>(FrpService);
    prismaService = module.get<PrismaService>(PrismaService);
    dockerService = module.get<DockerService>(DockerService);
  });

  afterEach(async () => {
    await module.close();
    jest.clearAllMocks();
  });

  describe('Discovery Order Independence', () => {
    beforeEach(() => {
      // Setup common mocks
      (prismaService.host.findMany as jest.Mock).mockResolvedValue(mockHosts);
      (prismaService.host.findFirst as jest.Mock).mockImplementation((query) => {
        const address = query.where?.address;
        return Promise.resolve(mockHosts.find(h => h.address === address) || null);
      });
    });

    it('should handle FRPS discovered before FRPC (normal order)', async () => {
      // Setup mocks for FRPS host
      (dockerService.inspectContainers as jest.Mock)
        .mockResolvedValueOnce([mockFrpsContainer]) // FRPS host
        .mockResolvedValueOnce([mockFrpcContainer1]) // FRPC host 1
        .mockResolvedValueOnce([mockFrpcContainer2]); // FRPC host 2

      (dockerService.execShell as jest.Mock)
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpsConfig, stderr: '' }) // FRPS config
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpcConfig1, stderr: '' }) // FRPC config 1
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpcConfig2, stderr: '' }); // FRPC config 2

      // Mock database operations
      (prismaService.frpsConfig.upsert as jest.Mock).mockResolvedValue({
        id: 'frps-config-id',
        hostId: 'host-frps',
        containerId: 'frps-container-id',
        bindPort: 7000
      });

      (prismaService.frpcProxy.upsert as jest.Mock).mockResolvedValue({});
      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        },
        {
          id: 'proxy-2',
          name: 'ssh',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        }
      ]);

      (prismaService.frpsConfig.findFirst as jest.Mock).mockResolvedValue({
        id: 'frps-config-id',
        hostId: 'host-frps',
        bindPort: 7000
      });

      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});

      // Execute discovery in normal order: FRPS first, then FRPC clients
      await frpService.syncFrpFromHost('host-frps', 'parse');
      await frpService.syncFrpFromHost('host-frpc-1', 'parse');
      await frpService.syncFrpFromHost('host-frpc-2', 'parse');

      // Resolve dependencies
      await frpService.resolveFrpDependencies();

      // Verify FRPS config was created
      expect(prismaService.frpsConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            bindPort: 7000,
            hostId: 'host-frps'
          })
        })
      );

      // Verify FRPC proxies were created in pending state
      expect(prismaService.frpcProxy.upsert).toHaveBeenCalledTimes(2);

      // Verify dependency resolution linked the proxies
      expect(prismaService.frpcProxy.update).toHaveBeenCalledTimes(2);
      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            frpsConfigId: 'frps-config-id',
            syncStatus: 'linked'
          })
        })
      );
    });

    it('should handle FRPC discovered before FRPS (reverse order)', async () => {
      // Setup mocks for reverse order discovery
      (dockerService.inspectContainers as jest.Mock)
        .mockResolvedValueOnce([mockFrpcContainer1]) // FRPC host 1 first
        .mockResolvedValueOnce([mockFrpcContainer2]) // FRPC host 2 second
        .mockResolvedValueOnce([mockFrpsContainer]); // FRPS host last

      (dockerService.execShell as jest.Mock)
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpcConfig1, stderr: '' }) // FRPC config 1
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpcConfig2, stderr: '' }) // FRPC config 2
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpsConfig, stderr: '' }); // FRPS config

      // Mock database operations
      (prismaService.frpcProxy.upsert as jest.Mock).mockResolvedValue({});
      (prismaService.frpsConfig.upsert as jest.Mock).mockResolvedValue({
        id: 'frps-config-id',
        hostId: 'host-frps',
        containerId: 'frps-container-id',
        bindPort: 7000
      });

      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        },
        {
          id: 'proxy-2',
          name: 'ssh',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        }
      ]);

      (prismaService.frpsConfig.findFirst as jest.Mock).mockResolvedValue({
        id: 'frps-config-id',
        hostId: 'host-frps',
        bindPort: 7000
      });

      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});

      // Execute discovery in reverse order: FRPC clients first, then FRPS
      await frpService.syncFrpFromHost('host-frpc-1', 'parse');
      await frpService.syncFrpFromHost('host-frpc-2', 'parse');
      await frpService.syncFrpFromHost('host-frps', 'parse');

      // Resolve dependencies
      await frpService.resolveFrpDependencies();

      // Verify FRPC proxies were created in pending state first
      expect(prismaService.frpcProxy.upsert).toHaveBeenCalledTimes(2);

      // Verify FRPS config was created
      expect(prismaService.frpsConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            bindPort: 7000,
            hostId: 'host-frps'
          })
        })
      );

      // Verify dependency resolution linked the proxies
      expect(prismaService.frpcProxy.update).toHaveBeenCalledTimes(2);
      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            frpsConfigId: 'frps-config-id',
            syncStatus: 'linked'
          })
        })
      );
    });

    it('should handle mixed discovery order', async () => {
      // Setup mocks for mixed order discovery
      (dockerService.inspectContainers as jest.Mock)
        .mockResolvedValueOnce([mockFrpcContainer1]) // FRPC host 1 first
        .mockResolvedValueOnce([mockFrpsContainer]) // FRPS host second
        .mockResolvedValueOnce([mockFrpcContainer2]); // FRPC host 2 last

      (dockerService.execShell as jest.Mock)
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpcConfig1, stderr: '' }) // FRPC config 1
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpsConfig, stderr: '' }) // FRPS config
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpcConfig2, stderr: '' }); // FRPC config 2

      // Mock database operations
      (prismaService.frpcProxy.upsert as jest.Mock).mockResolvedValue({});
      (prismaService.frpsConfig.upsert as jest.Mock).mockResolvedValue({
        id: 'frps-config-id',
        hostId: 'host-frps',
        containerId: 'frps-container-id',
        bindPort: 7000
      });

      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        },
        {
          id: 'proxy-2',
          name: 'ssh',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        }
      ]);

      (prismaService.frpsConfig.findFirst as jest.Mock).mockResolvedValue({
        id: 'frps-config-id',
        hostId: 'host-frps',
        bindPort: 7000
      });

      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});

      // Execute discovery in mixed order
      await frpService.syncFrpFromHost('host-frpc-1', 'parse');
      await frpService.syncFrpFromHost('host-frps', 'parse');
      await frpService.syncFrpFromHost('host-frpc-2', 'parse');

      // Resolve dependencies
      await frpService.resolveFrpDependencies();

      // Verify all components were processed correctly
      expect(prismaService.frpcProxy.upsert).toHaveBeenCalledTimes(2);
      expect(prismaService.frpsConfig.upsert).toHaveBeenCalledTimes(1);
      expect(prismaService.frpcProxy.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling in Different Orders', () => {
    it('should handle missing FRPS config gracefully when FRPC is discovered first', async () => {
      // Setup mocks where FRPC is discovered but FRPS doesn't exist
      (dockerService.inspectContainers as jest.Mock)
        .mockResolvedValueOnce([mockFrpcContainer1]);

      (dockerService.execShell as jest.Mock)
        .mockResolvedValueOnce({ code: 0, stdout: mockFrpcConfig1, stderr: '' });

      (prismaService.frpcProxy.upsert as jest.Mock).mockResolvedValue({});
      (prismaService.frpcProxy.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'proxy-1',
          name: 'web',
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          frpsConfigId: null
        }
      ]);

      // No FRPS config found
      (prismaService.frpsConfig.findFirst as jest.Mock).mockResolvedValue(null);
      (prismaService.frpcProxy.update as jest.Mock).mockResolvedValue({});

      // Execute discovery
      await frpService.syncFrpFromHost('host-frpc-1', 'parse');
      await frpService.resolveFrpDependencies();

      // Verify FRPC proxy was created in pending state
      expect(prismaService.frpcProxy.upsert).toHaveBeenCalledTimes(1);

      // Verify dependency resolution marked it as failed
      expect(prismaService.frpcProxy.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            syncStatus: 'failed',
            linkErrorMessage: expect.stringContaining('FRPS config not found')
          })
        })
      );
    });
  });
});
