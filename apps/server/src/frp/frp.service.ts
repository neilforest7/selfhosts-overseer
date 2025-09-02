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
import { ActivityLogService } from '../activity-log/activity-log.service';

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

  async syncFrpFromHost(hostId: string): Promise<void> {
    const existingOpId = this.contextService.getOpId();
    if (existingOpId) {
      return this.runSyncLogic(hostId);
    } else {
      const opLog = await this.operationLogService.create({ title: `Sync FRP Config from host ${hostId}` });
      return this.contextService.run(opLog.id, () => this.runSyncLogic(hostId, opLog.id));
    }
  }

  private async runSyncLogic(hostId: string, opId?: string): Promise<void> {
    let isFailed = false;
    try {
      const host = await this.getHostWithCreds(hostId);
      if (!host) throw new Error(`Host not found: ${hostId}`);

      this.operationLogService.log('system', `Starting FRP sync for host ${host.name}`, hostId);
      const containers = await this.prisma.container.findMany({ where: { hostId } });
      const frpsContainers = containers.filter((c: any) => c.imageName?.includes('frps') || c.name.includes('frps'));
      const frpcContainers = containers.filter((c: any) => c.imageName?.includes('frpc') || c.name.includes('frpc'));

      this.operationLogService.log('info', `Found ${frpsContainers.length} frps and ${frpcContainers.length} frpc containers.`, hostId);

      for (const container of frpsContainers) {
        await this.syncFrpsConfig(host, container.id);
      }
      for (const container of frpcContainers) {
        await this.syncFrpcConfig(host, container.id);
      }
      this.operationLogService.log('system', 'FRP sync finished.', hostId);

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
      category: 'FRP_CONFIGURATION',
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
  }

  private async syncFrpcConfig(host: HostWithCreds, containerDbId: string) {
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

    const frpsHost = await this.prisma.host.findFirst({ where: { address: serverAddr } });
    if (!frpsHost) {
      this.operationLogService.log('error', `Could not find frps host with address: ${serverAddr}`);
      return;
    }

    const frpsConfig = await this.prisma.frpsConfig.findFirst({ where: { hostId: frpsHost.id, bindPort: serverPort } });
    if (!frpsConfig) {
      this.operationLogService.log('error', `Could not find frps config on host ${frpsHost.name} with bind_port ${serverPort}`);
      return;
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

      await this.prisma.frpcProxy.upsert({
        where: { id: `${inspectData.Id}-${proxyConfig.name}` },
        create: {
          id: `${inspectData.Id}-${proxyConfig.name}`,
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
          frpsConfigId: frpsConfig.id,
        },
        update: {
          type: normalizedNewValues.type,
          localIp: normalizedNewValues.localIp,
          localPort: normalizedNewValues.localPort,
          remotePort: normalizedNewValues.remotePort,
          subdomain: normalizedNewValues.subdomain,
          customDomains: normalizedNewValues.customDomains,
          rawConfig: proxyConfig,
          lastSyncedAt: new Date(),
        },
      });

      // Log activity for each proxy
      await this.activityLog.create({
        category: 'FRP_CONFIGURATION',
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
}
