import { Test, TestingModule } from '@nestjs/testing';
import { DockerRegistryService } from '../docker-registry.service';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { SettingsService } from '../../settings/settings.service';

// Mock fetch globally
global.fetch = jest.fn();

describe('DockerRegistryService', () => {
  let service: DockerRegistryService;
  let operationLogService: jest.Mocked<OperationLogService>;
  let settingsService: jest.Mocked<SettingsService>;

  beforeEach(async () => {
    const mockOperationLogService = {
      log: jest.fn(),
    };

    const mockSettingsService = {
      get: jest.fn().mockResolvedValue({
        registryApiEnabled: true,
        registryApiTimeoutSeconds: 30,
        registryApiRetries: 3,
        registryApiConcurrency: 5,
        registryApiFallbackEnabled: true,
        registryApiCacheEnabled: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DockerRegistryService,
        {
          provide: OperationLogService,
          useValue: mockOperationLogService,
        },
        {
          provide: SettingsService,
          useValue: mockSettingsService,
        },
      ],
    }).compile();

    service = module.get<DockerRegistryService>(DockerRegistryService);
    operationLogService = module.get(OperationLogService);
    settingsService = module.get(SettingsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getRegistryConfig', () => {
    it('should return Docker Hub config for official images', () => {
      const config = (service as any).getRegistryConfig('nginx:latest');
      expect(config.authUrl).toBe('https://auth.docker.io/token');
      expect(config.registryUrl).toBe('https://registry-1.docker.io/v2');
      expect(config.scope).toBe('repository:library/nginx:pull');
      expect(config.service).toBe('registry.docker.io');
    });

    it('should return Docker Hub config for user images', () => {
      const config = (service as any).getRegistryConfig('user/image:tag');
      expect(config.authUrl).toBe('https://auth.docker.io/token');
      expect(config.registryUrl).toBe('https://registry-1.docker.io/v2');
      expect(config.scope).toBe('repository:user/image:pull');
      expect(config.service).toBe('registry.docker.io');
    });

    it('should handle docker.io prefixed images', () => {
      const config = (service as any).getRegistryConfig('docker.io/user/image:tag');
      expect(config.scope).toBe('repository:user/image:pull');
    });

    // 修复后的关键测试用例
    it('should correctly handle Docker Hub user images with version tags containing dots', () => {
      const config = (service as any).getRegistryConfig('sosedoff/pgweb:0.16.1');
      expect(config.authUrl).toBe('https://auth.docker.io/token');
      expect(config.registryUrl).toBe('https://registry-1.docker.io/v2');
      expect(config.scope).toBe('repository:sosedoff/pgweb:pull');
      expect(config.service).toBe('registry.docker.io');
    });

    it('should correctly handle official images with version tags containing dots', () => {
      const config = (service as any).getRegistryConfig('nginx:1.21.0');
      expect(config.authUrl).toBe('https://auth.docker.io/token');
      expect(config.registryUrl).toBe('https://registry-1.docker.io/v2');
      expect(config.scope).toBe('repository:library/nginx:pull');
      expect(config.service).toBe('registry.docker.io');
    });

    it('should correctly detect private registries with domain names', () => {
      const config = (service as any).getRegistryConfig('registry.example.com/app:1.0');
      expect(config.authUrl).toBe('https://registry.example.com/v2/auth');
      expect(config.registryUrl).toBe('https://registry.example.com/v2');
      expect(config.scope).toBe('repository:app:pull');
      expect(config.service).toBe('registry.example.com');
    });

    it('should correctly detect GHCR images', () => {
      const config = (service as any).getRegistryConfig('ghcr.io/user/repo:latest');
      expect(config.authUrl).toBe('https://ghcr.io/token');
      expect(config.registryUrl).toBe('https://ghcr.io/v2');
      expect(config.scope).toBe('repository:user/repo:pull');
      expect(config.service).toBe('ghcr.io');
    });

    it('should correctly detect Quay.io images', () => {
      const config = (service as any).getRegistryConfig('quay.io/user/repo:latest');
      expect(config.authUrl).toBe('https://quay.io/v2/auth');
      expect(config.registryUrl).toBe('https://quay.io/v2');
      expect(config.scope).toBe('repository:user/repo:pull');
      expect(config.service).toBe('quay.io');
    });

    it('should handle private registry with IP address', () => {
      const config = (service as any).getRegistryConfig('192.168.1.100:5000/app:latest');
      expect(config.authUrl).toBe('https://192.168.1.100:5000/v2/auth');
      expect(config.registryUrl).toBe('https://192.168.1.100:5000/v2');
      expect(config.scope).toBe('repository:app:pull');
      expect(config.service).toBe('192.168.1.100:5000');
    });
  });

  describe('getAuthToken', () => {
    it('should fetch and cache auth token successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          token: 'test-token',
          expires_in: 3600,
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const config = {
        authUrl: 'https://auth.docker.io/token',
        registryUrl: 'https://registry-1.docker.io/v2',
        scope: 'repository:nginx:pull',
        service: 'registry.docker.io',
      };

      const token = await (service as any).getAuthToken(config);
      expect(token).toBe('test-token');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://auth.docker.io/token'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Accept': 'application/json',
            'User-Agent': 'SelfHost-Serv-Agent/1.0',
          }),
        })
      );
    });

    it('should return cached token if still valid', async () => {
      // First call to populate cache
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          token: 'cached-token',
          expires_in: 3600,
        }),
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const config = {
        authUrl: 'https://auth.docker.io/token',
        registryUrl: 'https://registry-1.docker.io/v2',
        scope: 'repository:nginx:pull',
        service: 'registry.docker.io',
      };

      // First call
      await (service as any).getAuthToken(config);
      
      // Second call should use cache
      const token = await (service as any).getAuthToken(config);
      expect(token).toBe('cached-token');
      expect(global.fetch).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should handle auth request failure', async () => {
      const mockResponse = {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      };
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      const config = {
        authUrl: 'https://auth.docker.io/token',
        registryUrl: 'https://registry-1.docker.io/v2',
        scope: 'repository:nginx:pull',
        service: 'registry.docker.io',
      };

      await expect((service as any).getAuthToken(config)).rejects.toThrow('Auth request failed: 401 Unauthorized');
    });
  });

  describe('getRemoteImageDigest', () => {
    it('should fetch remote digest successfully', async () => {
      // Mock auth token request
      const mockAuthResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          token: 'test-token',
          expires_in: 3600,
        }),
      };

      // Mock manifest request
      const mockManifestResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue('sha256:abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'),
        },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockAuthResponse)
        .mockResolvedValueOnce(mockManifestResponse);

      const result = await service.getRemoteImageDigest('nginx:latest');
      
      expect(result.digest).toBe('sha256:abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab');
      expect(result.error).toBeUndefined();
      expect(operationLogService.log).toHaveBeenCalledWith(
        'info',
        expect.stringContaining('Found remote digest for nginx:latest')
      );
    });

    it('should handle rate limiting', async () => {
      // Mock auth token request
      const mockAuthResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          token: 'test-token',
          expires_in: 3600,
        }),
      };

      // Mock rate limited manifest request
      const mockManifestResponse = {
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockAuthResponse)
        .mockResolvedValueOnce(mockManifestResponse);

      const result = await service.getRemoteImageDigest('nginx:latest');
      
      expect(result.rateLimited).toBe(true);
      expect(result.error).toBe('Rate limited by registry');
    });

    it('should handle missing digest in response', async () => {
      // Mock auth token request
      const mockAuthResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          token: 'test-token',
          expires_in: 3600,
        }),
      };

      // Mock manifest request without digest header
      const mockManifestResponse = {
        ok: true,
        headers: {
          get: jest.fn().mockReturnValue(null),
        },
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockAuthResponse)
        .mockResolvedValueOnce(mockManifestResponse);

      const result = await service.getRemoteImageDigest('nginx:latest');

      expect(result.error).toBe('No digest found in manifest response headers');
    });

    it('should handle OCI format errors correctly', async () => {
      // Mock auth token request
      const mockAuthResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          token: 'test-token',
          expires_in: 3600,
        }),
      };

      // Mock OCI format error response
      const mockManifestResponse = {
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('{"errors":[{"code":"MANIFEST_UNKNOWN","message":"OCI index found, but Accept header does not support OCI indexes"}]}'),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockAuthResponse)
        .mockResolvedValueOnce(mockManifestResponse);

      const result = await service.getRemoteImageDigest('ghcr.io/user/repo:latest');

      expect(result.error).toBe('Manifest format not supported. This has been fixed - please try again.');
    });

    it('should handle GHCR access denied errors', async () => {
      // Mock auth token request
      const mockAuthResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          token: 'test-token',
          expires_in: 3600,
        }),
      };

      // Mock access denied response
      const mockManifestResponse = {
        ok: false,
        status: 403,
        text: jest.fn().mockResolvedValue('{"errors":[{"code":"DENIED","message":"requested access to the resource is denied"}]}'),
      };

      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockAuthResponse)
        .mockResolvedValueOnce(mockManifestResponse);

      const result = await service.getRemoteImageDigest('ghcr.io/private/repo:latest');

      expect(result.error).toContain('Access denied for GHCR image');
      expect(result.error).toContain('private repository requiring GitHub authentication');
    });
  });

  describe('batchGetRemoteImageDigests', () => {
    it('should process multiple images with concurrency control', async () => {
      const imageRefs = ['nginx:latest', 'alpine:latest', 'ubuntu:latest'];
      
      // Mock successful responses for all images
      jest.spyOn(service, 'getRemoteImageDigest')
        .mockResolvedValueOnce({ digest: 'sha256:nginx-digest' })
        .mockResolvedValueOnce({ digest: 'sha256:alpine-digest' })
        .mockResolvedValueOnce({ digest: 'sha256:ubuntu-digest' });

      const results = await service.batchGetRemoteImageDigests(imageRefs, 2);
      
      expect(results.size).toBe(3);
      expect(results.get('nginx:latest')?.digest).toBe('sha256:nginx-digest');
      expect(results.get('alpine:latest')?.digest).toBe('sha256:alpine-digest');
      expect(results.get('ubuntu:latest')?.digest).toBe('sha256:ubuntu-digest');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when service is working', async () => {
      jest.spyOn(service as any, 'getAuthToken').mockResolvedValue('test-token');

      const result = await service.healthCheck();
      
      expect(result.healthy).toBe(true);
      expect(result.details).toHaveProperty('tokenCacheSize');
      expect(result.details).toHaveProperty('lastTokenCheck');
    });

    it('should return unhealthy status when service fails', async () => {
      jest.spyOn(service as any, 'getAuthToken').mockRejectedValue(new Error('Service unavailable'));

      const result = await service.healthCheck();
      
      expect(result.healthy).toBe(false);
      expect(result.details.error).toBe('Service unavailable');
    });
  });
});
