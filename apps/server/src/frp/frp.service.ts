import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { Host } from '@prisma/client';
import * as path from 'path';
import * as ini from 'ini';
import * as toml from '@iarna/toml';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';
import { ActivityLogService, ActivityCategory } from '../activity-log/activity-log.service';

type HostWithCreds = Host & {
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
};

@Injectable()
export class FrpService {
  private readonly logger = new Logger(FrpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
    private readonly contextService: ContextService,
    private readonly activityLog: ActivityLogService,
  ) {}

  async syncFrpFromHost(hostId: string, phase: 'parse' | 'link' = 'parse'): Promise<void> {
    const existingOpId = this.contextService.getOpId();
    if (existingOpId) {
      return this.runSyncLogic(hostId, undefined, phase);
    } else {
      const opLog = await this.operationLogService.create({
        title: `Sync FRP Config from host ${hostId} (${phase} phase)`
      });
      return this.contextService.run(opLog.id, () => this.runSyncLogic(hostId, opLog.id, phase));
    }
  }

  private async runSyncLogic(hostId: string, opId?: string, phase: 'parse' | 'link' = 'parse'): Promise<void> {
    let isFailed = false;
    try {
      const host = await this.getHostWithCreds(hostId);
      if (!host) throw new Error(`Host not found: ${hostId}`);

      this.operationLogService.log('system', `Starting FRP sync for host ${host.name} (${phase} phase)`, hostId);
      const containers = await this.prisma.container.findMany({ where: { hostId } });
      const frpsContainers = containers.filter((c: any) => c.imageName?.includes('frps') || c.name.includes('frps'));
      const frpcContainers = containers.filter((c: any) => c.imageName?.includes('frpc') || c.name.includes('frpc'));

      this.operationLogService.log('info', `Found ${frpsContainers.length} frps and ${frpcContainers.length} frpc containers.`, hostId);

      // Always sync FRPS configs (they don't have dependencies)
      for (const container of frpsContainers) {
        await this.syncFrpsConfig(host, container.id);
      }

      // For FRPC configs, behavior depends on phase
      for (const container of frpcContainers) {
        await this.syncFrpcConfig(host, container.id, phase);
      }
      this.operationLogService.log('system', `FRP sync finished (${phase} phase).`, hostId);

    } catch (err) {
      isFailed = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.operationLogService.log('error', `FRP sync failed: ${errorMessage}`, hostId);
    } finally {
      if (opId) { // Only update status if this is the top-level operation
        await this.operationLogService.updateStatus(opId, isFailed ? 'ERROR' : 'COMPLETED');
      }
    }
  }

  private async syncFrpsConfig(host: HostWithCreds, containerDbId: string) {
    this.operationLogService.log('info', `Processing frps container: ${containerDbId}`);
    const inspectData = await this.getInspectData(host, containerDbId);
    if (!inspectData) return;

    const configPath = await this.findConfigPath(host, inspectData, ['frps.ini', 'frps.toml']);
    if (!configPath) {
      this.operationLogService.log('error', `Could not find frps config for container ${inspectData.Id}`);
      return;
    }
    
    const content = await this.readRemoteFile(host, configPath);
    if (!content) {
      this.operationLogService.log('error', `Could not read frps config at: ${configPath}`);
      return;
    }

    const config = this.parseConfig(content.toString(), configPath);
    const common = config.common || config;

    // Check if FRPS config exists for activity logging
    const existingFrpsConfig = await this.prisma.frpsConfig.findUnique({
      where: { id: `${inspectData.Id}` },
    });

    // Normalize values for consistent comparison
    const normalizedNewValues = {
      bindPort: parseInt(common.bind_port || common.bindPort || config.bind_port || config.bindPort) || 0,
      vhostHttpPort: parseInt(common.vhost_http_port || common.vhostHttpPort || config.vhost_http_port || config.vhostHttpPort) || 0,
      vhostHttpsPort: parseInt(common.vhost_https_port || common.vhostHttpsPort || config.vhost_https_port || config.vhostHttpsPort) || 0,
      subdomainHost: (common.subdomain_host || common.subdomainHost || config.subdomain_host || config.subdomainHost || '').trim(),
    };

    const normalizedOldValues = existingFrpsConfig ? {
      bindPort: existingFrpsConfig.bindPort || 0,
      vhostHttpPort: existingFrpsConfig.vhostHttpPort || 0,
      vhostHttpsPort: existingFrpsConfig.vhostHttpsPort || 0,
      subdomainHost: (existingFrpsConfig.subdomainHost || '').trim(),
    } : undefined;

    await this.prisma.frpsConfig.upsert({
      where: { id: `${inspectData.Id}` },
      create: {
        id: `${inspectData.Id}`,
        containerId: inspectData.Id,
        hostId: host.id,
        bindPort: normalizedNewValues.bindPort,
        vhostHttpPort: normalizedNewValues.vhostHttpPort,
        vhostHttpsPort: normalizedNewValues.vhostHttpsPort,
        subdomainHost: normalizedNewValues.subdomainHost,
        rawConfig: config,
        lastSyncedAt: new Date(),
      },
      update: {
        bindPort: normalizedNewValues.bindPort,
        vhostHttpPort: normalizedNewValues.vhostHttpPort,
        vhostHttpsPort: normalizedNewValues.vhostHttpsPort,
        subdomainHost: normalizedNewValues.subdomainHost,
        rawConfig: config,
        lastSyncedAt: new Date(),
      },
    });
    this.operationLogService.log('info', `Upserted frps config for container ${inspectData.Id}`);

    // Log activity
    await this.activityLog.create({
      category: ActivityCategory.FRP_CONFIGURATION,
      action: existingFrpsConfig ? 'frps_config_updated' : 'frps_config_created',
      resourceType: 'frps_config',
      resourceId: inspectData.Id,
      resourceName: `FRPS-${inspectData.Id.substring(0, 12)}`,
      hostId: host.id,
      hostName: host.name,
      title: `FRPS configuration ${existingFrpsConfig ? 'updated' : 'created'}`,
      description: `FRPS server configuration ${existingFrpsConfig ? 'updated' : 'created'} for container ${inspectData.Id.substring(0, 12)}`,
      metadata: {
        containerId: inspectData.Id,
        bindPort: normalizedNewValues.bindPort,
        vhostHttpPort: normalizedNewValues.vhostHttpPort,
        vhostHttpsPort: normalizedNewValues.vhostHttpsPort,
        subdomainHost: normalizedNewValues.subdomainHost,
      },
      oldValues: normalizedOldValues,
      newValues: normalizedNewValues,
    });

    await this.updateContainerWithWebServerPort(containerDbId, config);

    // Trigger immediate dependency resolution for pending FRPC proxies that might match this FRPS
    // This ensures that if an FRPS is discovered after FRPC, the linking happens immediately
    this.operationLogService.log('info', `Triggering dependency resolution for newly discovered FRPS (bind_port: ${normalizedNewValues.bindPort})`);
    try {
      await this.resolvePendingProxiesForFrps(host.address, normalizedNewValues.bindPort);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `Failed to resolve pending proxies for FRPS: ${errorMessage}`);
    }
  }

  private async syncFrpcConfig(host: HostWithCreds, containerDbId: string, phase: 'parse' | 'link' = 'parse') {
    this.operationLogService.log('info', `Processing frpc container: ${containerDbId}`);
    const inspectData = await this.getInspectData(host, containerDbId);
    if (!inspectData) return;

    const configPath = await this.findConfigPath(host, inspectData, ['frpc.ini', 'frpc.toml']);
    if (!configPath) {
      this.operationLogService.log('error', `Could not find frpc config for container ${inspectData.Id}`);
      return;
    }

    const content = await this.readRemoteFile(host, configPath);
    if (!content) {
      this.operationLogService.log('error', `Could not read frpc config at: ${configPath}`);
      return;
    }

    const config = this.parseConfig(content.toString(), configPath);
    const common = config.common || config;
    const serverAddr = common.server_addr || common.serverAddr || config.server_addr || config.serverAddr;
    const serverPort = common.server_port ? parseInt(common.server_port) : (common.serverPort ? parseInt(common.serverPort) : (config.server_port ? parseInt(config.server_port) : (config.serverPort ? parseInt(config.serverPort) : undefined)));

    if (!serverAddr || !serverPort) {
      this.operationLogService.log('error', `frpc config for ${inspectData.Id} is missing server address or port.`);
      return;
    }

    // Phase-dependent logic for FRPS config resolution
    let frpsConfig: any = null;

    if (phase === 'parse') {
      // In parse phase, we don't require FRPS config to exist yet
      // We'll store the server info for later linking
      this.operationLogService.log('info', `Parse phase: storing FRPC config with pending server ${serverAddr}:${serverPort}`);
    } else {
      // In link phase, we try to find the FRPS config
      const frpsHost = await this.prisma.host.findFirst({ where: { address: serverAddr } });
      if (!frpsHost) {
        this.operationLogService.log('error', `Could not find frps host with address: ${serverAddr}`);
        return;
      }

      frpsConfig = await this.prisma.frpsConfig.findFirst({ where: { hostId: frpsHost.id, bindPort: serverPort } });
      if (!frpsConfig) {
        this.operationLogService.log('error', `Could not find frps config on host ${frpsHost.name} with bind_port ${serverPort}`);
        return;
      }
    }

    let proxies: any[] = [];
    if (Array.isArray(config.proxies)) {
      proxies = config.proxies;
    } else {
      proxies = Object.entries(config)
        .filter(([key, value]) => key !== 'common' && typeof value === 'object' && value !== null)
        .map(([name, value]) => ({ name, ...(value as object) }));
    }

    for (const proxyConfig of proxies) {
      if ((proxyConfig as any).type === 'xtcp') {
        this.operationLogService.log('info', `Skipping xtcp proxy ${proxyConfig.name} as it does not have a remote_port.`);
        continue;
      }

      const localPort = parseInt((proxyConfig as any).local_port || (proxyConfig as any).localPort);
      const remotePort = parseInt((proxyConfig as any).remote_port || (proxyConfig as any).remotePort);

      if (isNaN(localPort) || isNaN(remotePort)) {
        this.operationLogService.log('error', `Skipping proxy ${proxyConfig.name} due to missing or invalid local_port or remote_port.`);
        continue;
      }

      // Check if FRPC proxy exists for activity logging
      const existingFrpcProxy = await this.prisma.frpcProxy.findUnique({
        where: { id: `${inspectData.Id}-${proxyConfig.name}` },
      });

      // Normalize values for consistent comparison
      const normalizedNewValues = {
        type: ((proxyConfig as any).type || 'tcp').toString().trim(),
        localIp: ((proxyConfig as any).local_ip || (proxyConfig as any).localIp || '127.0.0.1').trim(),
        localPort,
        remotePort,
        subdomain: ((proxyConfig as any).subdomain || '').trim(),
        customDomains: (proxyConfig as any).custom_domains?.split(',').map((d: string) => d.trim()).filter(Boolean) ||
                      (proxyConfig as any).customDomains || [],
      };

      const normalizedOldValues = existingFrpcProxy ? {
        type: (existingFrpcProxy.type || 'tcp').trim(),
        localIp: (existingFrpcProxy.localIp || '127.0.0.1').trim(),
        localPort: existingFrpcProxy.localPort || 0,
        remotePort: existingFrpcProxy.remotePort || 0,
        subdomain: (existingFrpcProxy.subdomain || '').trim(),
        customDomains: existingFrpcProxy.customDomains || [],
      } : undefined;

      // Create/update proxy with phase-appropriate data
      const baseProxyData = {
        hostId: host.id,
        containerId: inspectData.Id,
        name: proxyConfig.name,
        type: normalizedNewValues.type,
        localIp: normalizedNewValues.localIp,
        localPort: normalizedNewValues.localPort,
        remotePort: normalizedNewValues.remotePort,
        subdomain: normalizedNewValues.subdomain,
        customDomains: normalizedNewValues.customDomains,
        rawConfig: proxyConfig,
        lastSyncedAt: new Date(),
      };

      if (phase === 'parse') {
        // In parse phase, store with pending status and server info
        await this.prisma.frpcProxy.upsert({
          where: { id: `${inspectData.Id}-${proxyConfig.name}` },
          create: {
            id: `${inspectData.Id}-${proxyConfig.name}`,
            ...baseProxyData,
            syncStatus: 'pending',
            pendingServerAddr: serverAddr,
            pendingServerPort: serverPort,
            frpsConfigId: null,
          },
          update: {
            ...baseProxyData,
            syncStatus: 'pending',
            pendingServerAddr: serverAddr,
            pendingServerPort: serverPort,
            lastLinkAttempt: null,
            linkErrorMessage: null,
          },
        });
      } else {
        // In link phase, create with actual FRPS config ID
        await this.prisma.frpcProxy.upsert({
          where: { id: `${inspectData.Id}-${proxyConfig.name}` },
          create: {
            id: `${inspectData.Id}-${proxyConfig.name}`,
            ...baseProxyData,
            syncStatus: 'linked',
            frpsConfigId: frpsConfig.id,
          },
          update: {
            ...baseProxyData,
            syncStatus: 'linked',
            frpsConfigId: frpsConfig.id,
            lastLinkAttempt: new Date(),
            linkErrorMessage: null,
          },
        });
      }

      // Log activity for each proxy
      await this.activityLog.create({
        category: ActivityCategory.FRP_CONFIGURATION,
        action: existingFrpcProxy ? 'frpc_proxy_updated' : 'frpc_proxy_created',
        resourceType: 'frpc_proxy',
        resourceId: `${inspectData.Id}-${proxyConfig.name}`,
        resourceName: `${proxyConfig.name}`,
        hostId: host.id,
        hostName: host.name,
        title: `FRPC proxy '${proxyConfig.name}' ${existingFrpcProxy ? 'updated' : 'created'}`,
        description: `FRPC proxy configuration ${existingFrpcProxy ? 'updated' : 'created'}: ${normalizedNewValues.localIp}:${normalizedNewValues.localPort} → ${normalizedNewValues.remotePort}`,
        metadata: {
          containerId: inspectData.Id,
          proxyName: proxyConfig.name,
          type: normalizedNewValues.type,
          localIp: normalizedNewValues.localIp,
          localPort: normalizedNewValues.localPort,
          remotePort: normalizedNewValues.remotePort,
          subdomain: normalizedNewValues.subdomain,
          customDomains: normalizedNewValues.customDomains,
        },
        oldValues: normalizedOldValues,
        newValues: normalizedNewValues,
      });
    }
    this.operationLogService.log('info', `Upserted ${proxies.length} frpc proxies for container ${inspectData.Id}`);
    await this.updateContainerWithWebServerPort(containerDbId, config);
  }

  async getFrpConfigs() {
    const frpsConfigs = await this.prisma.frpsConfig.findMany();
    const frpcProxies = await this.prisma.frpcProxy.findMany();
    return {
      frps: frpsConfigs,
      frpc: frpcProxies,
    };
  }

  /**
   * Phase 2: Resolve FRP dependencies after all hosts have been discovered
   */
  async resolveFrpDependencies(): Promise<{
    resolvedCount: number;
    failedCount: number;
    totalPending: number;
  }> {
    const existingOpId = this.contextService.getOpId();
    if (existingOpId) {
      return this.runDependencyResolution();
    } else {
      const opLog = await this.operationLogService.create({
        title: 'Resolve FRP Dependencies'
      });
      return this.contextService.run(opLog.id, () => this.runDependencyResolution(opLog.id));
    }
  }

  private async runDependencyResolution(opId?: string): Promise<{
    resolvedCount: number;
    failedCount: number;
    totalPending: number;
  }> {
    let isFailed = false;
    let resolvedCount = 0;
    let failedCount = 0;
    let totalPending = 0;

    try {
      this.operationLogService.log('system', 'Starting FRP dependency resolution...');

      const pendingProxies = await this.prisma.frpcProxy.findMany({
        where: { syncStatus: 'pending' }
      });

      totalPending = pendingProxies.length;
      this.operationLogService.log('info', `Found ${totalPending} pending FRPC proxies to resolve`);

      // Log details of pending proxies for debugging
      for (const proxy of pendingProxies) {
        this.operationLogService.log('info', `Pending proxy: ${proxy.name} -> ${proxy.pendingServerAddr}:${proxy.pendingServerPort}`);
      }

      for (const proxy of pendingProxies) {
        try {
          this.operationLogService.log('info', `Attempting to link proxy: ${proxy.name}`);
          const success = await this.linkFrpcToFrps(proxy);
          if (success) {
            resolvedCount++;
            this.operationLogService.log('info', `✅ Successfully linked proxy: ${proxy.name}`);
          } else {
            failedCount++;
            this.operationLogService.log('error', `❌ Failed to link proxy: ${proxy.name}`);
          }
        } catch (error) {
          failedCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.operationLogService.log('error', `Failed to link proxy ${proxy.name}: ${errorMessage}`);
        }
      }

      this.operationLogService.log('system', `FRP dependency resolution completed. Resolved: ${resolvedCount}, Failed: ${failedCount}`);

    } catch (err) {
      isFailed = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.operationLogService.log('error', `FRP dependency resolution failed: ${errorMessage}`);
    } finally {
      if (opId) {
        await this.operationLogService.updateStatus(opId, isFailed ? 'ERROR' : 'COMPLETED');
      }
    }

    return {
      resolvedCount,
      failedCount,
      totalPending
    };
  }

  /**
   * Link a pending FRPC proxy to its FRPS config
   */
  private async linkFrpcToFrps(proxy: any): Promise<boolean> {
    this.operationLogService.log('info', `🔗 Linking proxy ${proxy.name}: ${proxy.pendingServerAddr}:${proxy.pendingServerPort}`);

    if (!proxy.pendingServerAddr || !proxy.pendingServerPort) {
      const errorMsg = 'Missing server address or port information';
      this.operationLogService.log('error', `❌ ${proxy.name}: ${errorMsg}`);
      await this.prisma.frpcProxy.update({
        where: { id: proxy.id },
        data: {
          syncStatus: 'failed',
          lastLinkAttempt: new Date(),
          linkErrorMessage: errorMsg
        }
      });
      return false;
    }

    // Find the FRPS host
    this.operationLogService.log('info', `🔍 Looking for FRPS host: ${proxy.pendingServerAddr}`);
    const frpsHost = await this.prisma.host.findFirst({
      where: { address: proxy.pendingServerAddr }
    });

    if (!frpsHost) {
      const errorMsg = `FRPS host not found: ${proxy.pendingServerAddr}`;
      this.operationLogService.log('error', `❌ ${proxy.name}: ${errorMsg}`);
      await this.prisma.frpcProxy.update({
        where: { id: proxy.id },
        data: {
          syncStatus: 'failed',
          lastLinkAttempt: new Date(),
          linkErrorMessage: errorMsg
        }
      });
      return false;
    }

    this.operationLogService.log('info', `✅ Found FRPS host: ${frpsHost.name} [${frpsHost.id}]`);

    // Find the FRPS config
    this.operationLogService.log('info', `🔍 Looking for FRPS config on host ${frpsHost.name} with bind_port ${proxy.pendingServerPort}`);
    const frpsConfig = await this.prisma.frpsConfig.findFirst({
      where: {
        hostId: frpsHost.id,
        bindPort: proxy.pendingServerPort
      }
    });

    if (!frpsConfig) {
      // Get available FRPS configs for debugging
      const availableConfigs = await this.prisma.frpsConfig.findMany({
        where: { hostId: frpsHost.id },
        select: { id: true, bindPort: true }
      });

      const errorMsg = `FRPS config not found on host ${frpsHost.name} with bind_port ${proxy.pendingServerPort}`;
      this.operationLogService.log('error', `❌ ${proxy.name}: ${errorMsg}`);
      this.operationLogService.log('info', `Available FRPS configs on ${frpsHost.name}: ${availableConfigs.map(c => `port ${c.bindPort} (${c.id})`).join(', ') || 'none'}`);

      await this.prisma.frpcProxy.update({
        where: { id: proxy.id },
        data: {
          syncStatus: 'failed',
          lastLinkAttempt: new Date(),
          linkErrorMessage: errorMsg
        }
      });
      return false;
    }

    this.operationLogService.log('info', `✅ Found FRPS config: ${frpsConfig.id} (bind_port: ${frpsConfig.bindPort})`);

    // Successfully link the proxy
    await this.prisma.frpcProxy.update({
      where: { id: proxy.id },
      data: {
        frpsConfigId: frpsConfig.id,
        syncStatus: 'linked',
        lastLinkAttempt: new Date(),
        linkErrorMessage: null
      }
    });

    this.operationLogService.log('info', `🎉 Successfully linked FRPC proxy ${proxy.name} to FRPS config ${frpsConfig.id}`);
    return true;
  }

  /**
   * Resolve pending FRPC proxies that match a specific FRPS server
   * This is called immediately when an FRPS config is discovered
   */
  private async resolvePendingProxiesForFrps(serverAddr: string, bindPort: number): Promise<void> {
    this.operationLogService.log('info', `🔍 Looking for pending FRPC proxies targeting ${serverAddr}:${bindPort}`);

    const matchingProxies = await this.prisma.frpcProxy.findMany({
      where: {
        syncStatus: 'pending',
        pendingServerAddr: serverAddr,
        pendingServerPort: bindPort
      }
    });

    if (matchingProxies.length === 0) {
      this.operationLogService.log('info', `No pending FRPC proxies found for ${serverAddr}:${bindPort}`);
      return;
    }

    this.operationLogService.log('info', `Found ${matchingProxies.length} pending FRPC proxies for ${serverAddr}:${bindPort}`);

    let resolvedCount = 0;
    let failedCount = 0;

    for (const proxy of matchingProxies) {
      try {
        this.operationLogService.log('info', `🔗 Attempting immediate link for proxy: ${proxy.name}`);
        const success = await this.linkFrpcToFrps(proxy);
        if (success) {
          resolvedCount++;
        } else {
          failedCount++;
        }
      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.operationLogService.log('error', `Failed to immediately link proxy ${proxy.name}: ${errorMessage}`);
      }
    }

    this.operationLogService.log('info', `Immediate resolution for ${serverAddr}:${bindPort} completed. Resolved: ${resolvedCount}, Failed: ${failedCount}`);
  }

  private async updateContainerWithWebServerPort(containerDbId: string, config: any) {
    const webServerConfig = config.webServer || config.web_server;
    const webPort = webServerConfig?.port ? parseInt(webServerConfig.port) : undefined;

    if (!webPort) {
      return;
    }

    const container = await this.prisma.container.findUnique({
      where: { id: containerDbId },
      select: { ports: true },
    });

    if (!container) {
      return;
    }

    const existingPorts = Array.isArray(container.ports) ? (container.ports as any[]) : [];

    const alreadyExists = existingPorts.some(p =>
      p.bindings && Array.isArray(p.bindings) &&
      p.bindings.some((b: any) => b.HostPort === String(webPort))
    );

    if (!alreadyExists) {
      const newPortEntry = {
        key: `${webPort}/tcp`,
        bindings: [{ HostIp: '0.0.0.0', HostPort: String(webPort) }]
      };
      const updatedPorts = [...existingPorts, newPortEntry];
      await this.prisma.container.update({
        where: { id: containerDbId },
        data: { ports: updatedPorts },
      });
      this.operationLogService.log('info', `Added web server port ${webPort} to container ${containerDbId}`);
    }
  }

  private parseConfig(content: string, filePath: string): any {
    try {
      if (filePath.endsWith('.toml')) {
        return toml.parse(content);
      }
      return ini.parse(content);
    } catch (e) {
      this.logger.error(`[FRP Sync] Failed to parse config file ${filePath}`, e);
      return {};
    }
  }

  private async getHostWithCreds(hostId: string): Promise<HostWithCreds | null> {
    const host = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!host) return null;
    
    const decPassword = this.crypto.decryptString(host.sshPassword)?.toString();
    const decKey = this.crypto.decryptString(host.sshPrivateKey)?.toString();
    const decPassphrase = this.crypto.decryptString(host.sshPrivateKeyPassphrase)?.toString();

    return {
      ...host,
      password: decPassword ?? undefined,
      privateKey: decKey ?? undefined,
      privateKeyPassphrase: decPassphrase ?? undefined,
    };
  }

  private async getInspectData(host: HostWithCreds, containerDbId: string) {
    const dbContainer = await this.prisma.container.findFirst({where: {id: containerDbId}});
    if(!dbContainer) {
        this.operationLogService.log('error', `Could not find container with db id ${containerDbId}`);
        return null;
    }
    const inspectResult = await this.docker.inspectContainers({...host, port: host.port ?? undefined}, [dbContainer.containerId || '']);
    if (!inspectResult || inspectResult.length === 0) {
        this.operationLogService.log('error', `docker.inspectContainers returned no data for container ${dbContainer.containerId}`);
        return null;
    }
    return inspectResult[0];
  }

  private async findConfigPath(host: HostWithCreds, inspectData: any, fileNames: string[]): Promise<string | null> {
    const mounts = inspectData?.Mounts as any[] || [];
    const triedPaths: string[] = [];
    for (const mount of mounts) {
        if (mount.Source) {
            // First, check if the mount source itself is the config file
            for (const fileName of fileNames) {
                if (mount.Source.endsWith(fileName)) {
                    this.operationLogService.log('info', `Found config file directly from mount source: ${mount.Source}`);
                    return mount.Source;
                }
            }

            // If not, treat it as a directory and check for config files inside
            for (const fileName of fileNames) {
                const potentialPath = path.join(mount.Source, fileName);
                triedPaths.push(potentialPath);
                this.operationLogService.log('info', `Checking for config file at: ${potentialPath}`);
                const { code } = await this.docker.execShell({...host, port: host.port ?? undefined}, `test -f "${potentialPath}"`);
                if (code === 0) {
                    return potentialPath;
                }
            }
        }
    }
    this.operationLogService.log('error', `Could not find config file for container ${inspectData.Id}. Tried paths: ${triedPaths.join(', ')}`);
    return null;
  }

  private async readRemoteFile(host: HostWithCreds, filePath: string): Promise<string | Buffer | null> {
    const { code, stdout, stderr } = await this.docker.execShell({...host, port: host.port ?? undefined}, `cat "${filePath}"`);
    if (code !== 0) {
      this.logger.warn(`[FRP Sync] Failed to read remote file ${filePath} on host ${host.name}. Stderr: ${stderr.toString()}`);
      return null;
    }
    return stdout;
  }

  /**
   * Validate FRP topology integrity and return health status
   */
  async validateFrpTopology(): Promise<{
    totalFrpcProxies: number;
    linkedProxies: number;
    pendingProxies: number;
    failedProxies: number;
    orphanedProxies: number;
    issues: string[];
    isHealthy: boolean;
  }> {
    const allProxies = await this.prisma.frpcProxy.findMany({
      include: {
        frps: true
      }
    });

    const linkedProxies = allProxies.filter(p => p.syncStatus === 'linked' && p.frpsConfigId);
    const pendingProxies = allProxies.filter(p => p.syncStatus === 'pending');
    const failedProxies = allProxies.filter(p => p.syncStatus === 'failed');
    const orphanedProxies = allProxies.filter(p => p.frpsConfigId && !p.frps);

    const issues: string[] = [];

    // Check for stale pending proxies (pending for more than 1 hour)
    const staleThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const stalePending = pendingProxies.filter(p =>
      p.lastLinkAttempt && p.lastLinkAttempt < staleThreshold
    );
    if (stalePending.length > 0) {
      issues.push(`${stalePending.length} FRPC proxies have been pending for over 1 hour`);
    }

    // Check for failed proxies
    if (failedProxies.length > 0) {
      issues.push(`${failedProxies.length} FRPC proxies failed to link to FRPS configs`);
    }

    // Check for orphaned proxies
    if (orphanedProxies.length > 0) {
      issues.push(`${orphanedProxies.length} FRPC proxies reference non-existent FRPS configs`);
    }

    // Check for missing server addresses
    const missingServerInfo = allProxies.filter(p =>
      p.syncStatus === 'pending' && (!p.pendingServerAddr || !p.pendingServerPort)
    );
    if (missingServerInfo.length > 0) {
      issues.push(`${missingServerInfo.length} FRPC proxies are missing server address information`);
    }

    const isHealthy = issues.length === 0 && failedProxies.length === 0 && orphanedProxies.length === 0;

    return {
      totalFrpcProxies: allProxies.length,
      linkedProxies: linkedProxies.length,
      pendingProxies: pendingProxies.length,
      failedProxies: failedProxies.length,
      orphanedProxies: orphanedProxies.length,
      issues,
      isHealthy
    };
  }

  /**
   * Heal broken FRP relationships and retry failed connections
   */
  async healFrpRelationships(): Promise<{
    retriedCount: number;
    healedCount: number;
    cleanedCount: number;
    errors: string[];
  }> {
    const existingOpId = this.contextService.getOpId();
    if (existingOpId) {
      return this.runHealingLogic();
    } else {
      const opLog = await this.operationLogService.create({
        title: 'Heal FRP Relationships'
      });
      return this.contextService.run(opLog.id, () => this.runHealingLogic(opLog.id));
    }
  }

  private async runHealingLogic(opId?: string): Promise<{
    retriedCount: number;
    healedCount: number;
    cleanedCount: number;
    errors: string[];
  }> {
    let isFailed = false;
    const errors: string[] = [];
    let retriedCount = 0;
    let healedCount = 0;
    let cleanedCount = 0;

    try {
      this.operationLogService.log('system', 'Starting FRP relationship healing...');

      // 1. Retry failed proxies
      const failedProxies = await this.prisma.frpcProxy.findMany({
        where: { syncStatus: 'failed' }
      });

      this.operationLogService.log('info', `Found ${failedProxies.length} failed FRPC proxies to retry`);

      for (const proxy of failedProxies) {
        try {
          retriedCount++;
          // Reset to pending status and clear error message
          await this.prisma.frpcProxy.update({
            where: { id: proxy.id },
            data: {
              syncStatus: 'pending',
              linkErrorMessage: null,
              lastLinkAttempt: null
            }
          });

          // Try to link again
          const success = await this.linkFrpcToFrps(proxy);
          if (success) {
            healedCount++;
            this.operationLogService.log('info', `Successfully healed FRPC proxy ${proxy.name}`);
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to heal proxy ${proxy.name}: ${errorMessage}`);
        }
      }

      // 2. Clean up orphaned proxies (proxies with non-existent FRPS configs)
      const orphanedProxies = await this.prisma.frpcProxy.findMany({
        where: {
          frpsConfigId: { not: null },
          frps: null
        }
      });

      if (orphanedProxies.length > 0) {
        this.operationLogService.log('info', `Found ${orphanedProxies.length} orphaned FRPC proxies to clean up`);

        for (const proxy of orphanedProxies) {
          try {
            await this.prisma.frpcProxy.update({
              where: { id: proxy.id },
              data: {
                frpsConfigId: null,
                syncStatus: 'pending',
                linkErrorMessage: 'FRPS config was deleted, reset to pending'
              }
            });
            cleanedCount++;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to clean orphaned proxy ${proxy.name}: ${errorMessage}`);
          }
        }
      }

      this.operationLogService.log('system',
        `FRP healing completed. Retried: ${retriedCount}, Healed: ${healedCount}, Cleaned: ${cleanedCount}, Errors: ${errors.length}`
      );

    } catch (err) {
      isFailed = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.operationLogService.log('error', `FRP healing failed: ${errorMessage}`);
      errors.push(errorMessage);
    } finally {
      if (opId) {
        await this.operationLogService.updateStatus(opId, isFailed ? 'ERROR' : 'COMPLETED');
      }
    }

    return {
      retriedCount,
      healedCount,
      cleanedCount,
      errors
    };
  }

  /**
   * Get comprehensive FRP sync statistics and metrics
   */
  async getFrpSyncMetrics(): Promise<{
    overview: {
      totalFrpsConfigs: number;
      totalFrpcProxies: number;
      healthyProxies: number;
      unhealthyProxies: number;
      healthPercentage: number;
    };
    syncStatus: {
      linked: number;
      pending: number;
      failed: number;
    };
    recentActivity: {
      lastSyncTime?: Date;
      syncFrequency: string;
      recentErrors: Array<{
        proxyName: string;
        errorMessage: string;
        timestamp: Date;
      }>;
    };
    performance: {
      averageLinkTime?: number;
      successRate: number;
      stalePendingCount: number;
    };
  }> {
    // Get basic counts
    const [frpsConfigs, frpcProxies] = await Promise.all([
      this.prisma.frpsConfig.count(),
      this.prisma.frpcProxy.findMany({
        select: {
          id: true,
          name: true,
          syncStatus: true,
          lastLinkAttempt: true,
          linkErrorMessage: true,
          lastSyncedAt: true
        },
        orderBy: { lastLinkAttempt: 'desc' }
      })
    ]);

    const linkedProxies = frpcProxies.filter(p => p.syncStatus === 'linked');
    const pendingProxies = frpcProxies.filter(p => p.syncStatus === 'pending');
    const failedProxies = frpcProxies.filter(p => p.syncStatus === 'failed');

    const healthyProxies = linkedProxies.length;
    const unhealthyProxies = pendingProxies.length + failedProxies.length;
    const healthPercentage = frpcProxies.length > 0
      ? Math.round((healthyProxies / frpcProxies.length) * 100)
      : 100;

    // Calculate performance metrics
    const staleThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
    const stalePendingCount = pendingProxies.filter(p =>
      p.lastLinkAttempt && p.lastLinkAttempt < staleThreshold
    ).length;

    const totalAttempts = frpcProxies.filter(p => p.lastLinkAttempt).length;
    const successRate = totalAttempts > 0
      ? Math.round((linkedProxies.length / totalAttempts) * 100)
      : 100;

    // Get recent errors
    const recentErrors = failedProxies
      .filter(p => p.linkErrorMessage && p.lastLinkAttempt)
      .slice(0, 5)
      .map(p => ({
        proxyName: p.name,
        errorMessage: p.linkErrorMessage!,
        timestamp: p.lastLinkAttempt!
      }));

    // Get last sync time
    const lastSyncTime = frpcProxies
      .filter(p => p.lastLinkAttempt)
      .sort((a, b) => b.lastLinkAttempt!.getTime() - a.lastLinkAttempt!.getTime())[0]?.lastLinkAttempt;

    return {
      overview: {
        totalFrpsConfigs: frpsConfigs,
        totalFrpcProxies: frpcProxies.length,
        healthyProxies,
        unhealthyProxies,
        healthPercentage
      },
      syncStatus: {
        linked: linkedProxies.length,
        pending: pendingProxies.length,
        failed: failedProxies.length
      },
      recentActivity: {
        lastSyncTime: lastSyncTime || undefined,
        syncFrequency: 'On container discovery',
        recentErrors
      },
      performance: {
        successRate,
        stalePendingCount
      }
    };
  }

  /**
   * Get detailed FRP sync logs for debugging
   */
  async getFrpSyncLogs(limit: number = 50): Promise<Array<{
    id: string;
    title: string;
    status: string;
    createdAt: Date;
    completedAt?: Date;
    duration?: number;
    entries: Array<{
      level: string;
      message: string;
      timestamp: Date;
      hostId?: string;
    }>;
  }>> {
    // Get recent FRP-related operation logs
    const operationLogs = await this.prisma.operationLog.findMany({
      where: {
        title: {
          contains: 'FRP'
        }
      },
      include: {
        entries: {
          orderBy: { timestamp: 'asc' }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });

    return operationLogs.map(log => ({
      id: log.id,
      title: log.title,
      status: log.status,
      createdAt: log.createdAt,
      completedAt: log.endTime || undefined,
      duration: log.endTime
        ? log.endTime.getTime() - log.createdAt.getTime()
        : undefined,
      entries: log.entries.map(entry => ({
        level: entry.stream,
        message: entry.content,
        timestamp: entry.timestamp,
        hostId: entry.hostId || undefined
      }))
    }));
  }
}
