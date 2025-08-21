import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { Host } from '@prisma/client';
import * as path from 'path';
import * as ini from 'ini';
import * as toml from '@iarna/toml';

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
  ) {}

  async syncFrpFromHost(hostId: string) {
    const host = await this.getHostWithCreds(hostId);
    if (!host) {
      this.logger.warn(`[FRP Sync] Host not found: ${hostId}`);
      return;
    }

    const containers = await this.prisma.container.findMany({ where: { hostId } });
    const frpsContainers = containers.filter((c: any) => c.imageName?.includes('frps') || c.name.includes('frps'));
    const frpcContainers = containers.filter((c: any) => c.imageName?.includes('frpc') || c.name.includes('frpc'));

    this.logger.log(`[FRP Sync] Found ${frpsContainers.length} frps containers and ${frpcContainers.length} frpc containers.`);

    for (const container of frpsContainers) {
      this.logger.log(`[FRP Sync] Processing frps container: ${container.name} (${container.id})`);
      await this.syncFrpsConfig(host, container.id);
    }

    for (const container of frpcContainers) {
      this.logger.log(`[FRP Sync] Processing frpc container: ${container.name} (${container.id})`);
      await this.syncFrpcConfig(host, container.id);
    }
  }

  private async syncFrpsConfig(host: HostWithCreds, containerDbId: string) {
    this.logger.log(`[FRP Sync] Syncing frps config for container ${containerDbId}`);
    const inspectData = await this.getInspectData(host, containerDbId);
    if (!inspectData) return;

    const configPath = await this.findConfigPath(host, inspectData, ['frps.ini', 'frps.toml']);
    if (!configPath) {
      this.logger.warn(`[FRP Sync] Could not find frps config for container ${inspectData.Id}`);
      return;
    }
    this.logger.log(`[FRP Sync] Found frps config at: ${configPath}`);

    const content = await this.readRemoteFile(host, configPath);
    if (!content) return;

    const config = this.parseConfig(content.toString(), configPath);
    const common = config.common || config;
    this.logger.log(`[FRP Sync] Parsed frps config: ${JSON.stringify(common)}`);

    const bindPortRaw = common.bind_port || common.bindPort;
    const vhostHttpPortRaw =
      common.vhost_http_port || common.vhostHttpPort || common.vhostHTTPPort;
    const vhostHttpsPortRaw =
      common.vhost_https_port || common.vhostHttpsPort || common.vhostHTTPSPort;
    const subdomainHostRaw = common.subdomain_host || common.subdomainHost;

    const result = await this.prisma.frpsConfig.upsert({
      where: { id: `${inspectData.Id}` },
      create: {
        id: `${inspectData.Id}`,
        containerId: inspectData.Id,
        hostId: host.id,
        bindPort: bindPortRaw ? parseInt(bindPortRaw) : undefined,
        vhostHttpPort: vhostHttpPortRaw ? parseInt(vhostHttpPortRaw) : undefined,
        vhostHttpsPort: vhostHttpsPortRaw
          ? parseInt(vhostHttpsPortRaw)
          : undefined,
        subdomainHost: subdomainHostRaw,
        rawConfig: config,
        lastSyncedAt: new Date(),
      },
      update: {
        bindPort: bindPortRaw ? parseInt(bindPortRaw) : undefined,
        vhostHttpPort: vhostHttpPortRaw ? parseInt(vhostHttpPortRaw) : undefined,
        vhostHttpsPort: vhostHttpsPortRaw
          ? parseInt(vhostHttpsPortRaw)
          : undefined,
        subdomainHost: subdomainHostRaw,
        rawConfig: config,
        lastSyncedAt: new Date(),
      },
    });
    this.logger.log(`[FRP Sync] Upserted frps config with id: ${result.id}`);
  }

  private async syncFrpcConfig(host: HostWithCreds, containerDbId: string) {
    this.logger.log(`[FRP Sync] Syncing frpc config for container ${containerDbId}`);
    const inspectData = await this.getInspectData(host, containerDbId);
    if (!inspectData) {
        this.logger.warn(`[FRP Sync] Could not get inspect data for container ${containerDbId}, aborting sync for this container.`);
        return;
    }

    const configPath = await this.findConfigPath(host, inspectData, ['frpc.ini', 'frpc.toml']);
    if (!configPath) {
      this.logger.warn(`[FRP Sync] Could not find frpc config for container ${inspectData.Id}`);
      return;
    }
    this.logger.log(`[FRP Sync] Found frpc config at: ${configPath}`);

    const content = await this.readRemoteFile(host, configPath);
    if (!content) return;

    const config = this.parseConfig(content.toString(), configPath);
    const common = config.common || config;
    this.logger.log(`[FRP Sync] Parsed frpc config common section: ${JSON.stringify(common)}`);

    const serverAddr = common.server_addr || common.serverAddr;
    const serverPort = common.server_port ? parseInt(common.server_port) : (common.serverPort ? parseInt(common.serverPort) : undefined);

    if (!serverAddr || !serverPort) {
      this.logger.warn(`[FRP Sync] frpc config for ${inspectData.Id} is missing server address or port.`);
      return;
    }

    const frpsHost = await this.prisma.host.findFirst({ where: { address: serverAddr } });
    if (!frpsHost) {
      this.logger.warn(`[FRP Sync] Could not find frps host with address: ${serverAddr}`);
      return;
    }

    const frpsConfig = await this.prisma.frpsConfig.findFirst({ where: { hostId: frpsHost.id, bindPort: serverPort } });
    if (!frpsConfig) {
      this.logger.warn(`[FRP Sync] Could not find frps config on host ${frpsHost.name} with bind_port ${serverPort}`);
      return;
    }
    this.logger.log(`[FRP Sync] Matched frpc to frps config: ${frpsConfig.id}`);

    const proxies = Array.isArray(config.proxies) ? config.proxies : Object.entries(config).filter(([key]) => key !== 'common').map(([name, value]) => ({ name, ...value as object }));

    for (const proxyConfig of proxies) {
      // Skip xtcp and other types that don't have a remote_port
      if (!proxyConfig.remote_port && !proxyConfig.remotePort) {
        this.logger.log(`[FRP Sync] Skipping proxy ${proxyConfig.name} of type ${proxyConfig.type} as it has no remote port.`);
        continue;
      }

      const name = proxyConfig.name;
      const result = await this.prisma.frpcProxy.upsert({
        where: { id: `${inspectData.Id}-${name}` },
        create: {
          id: `${inspectData.Id}-${name}`,
          hostId: host.id,
          containerId: inspectData.Id,
          name: name,
          type: proxyConfig.type,
          localIp: proxyConfig.local_ip || proxyConfig.localIP,
          localPort: parseInt(proxyConfig.local_port || proxyConfig.localPort),
          remotePort: parseInt(proxyConfig.remote_port || proxyConfig.remotePort),
          subdomain: proxyConfig.subdomain,
          customDomains: proxyConfig.custom_domains?.split(',') || proxyConfig.customDomains || [],
          rawConfig: proxyConfig,
          lastSyncedAt: new Date(),
          frps: {
            connect: {
              id: frpsConfig.id,
            },
          },
        },
        update: {
          type: proxyConfig.type,
          localIp: proxyConfig.local_ip || proxyConfig.localIP,
          localPort: parseInt(proxyConfig.local_port || proxyConfig.localPort),
          remotePort: parseInt(proxyConfig.remote_port || proxyConfig.remotePort),
          subdomain: proxyConfig.subdomain,
          customDomains: proxyConfig.custom_domains?.split(',') || proxyConfig.customDomains || [],
          rawConfig: proxyConfig,
          lastSyncedAt: new Date(),
        },
      });
      this.logger.log(`[FRP Sync] Upserted frpc proxy ${name} with id: ${result.id}`);
    }
  }

  async getFrpConfigs() {
    const frpsConfigs = await this.prisma.frpsConfig.findMany();
    const frpcProxies = await this.prisma.frpcProxy.findMany();
    return {
      frps: frpsConfigs,
      frpc: frpcProxies,
    };
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
    this.logger.log(`[FRP Sync] Getting inspect data for container with DB id: ${containerDbId}`);
    const dbContainer = await this.prisma.container.findFirst({where: {id: containerDbId}});
    if(!dbContainer) {
        this.logger.warn(`[FRP Sync] Could not find container with db id ${containerDbId}`);
        return null;
    }
    this.logger.log(`[FRP Sync] Found container in DB: ${dbContainer.name} (${dbContainer.containerId}). Fetching inspect data...`);
    const inspectResult = await this.docker.inspectContainers({...host, port: host.port ?? undefined}, [dbContainer.containerId]);
    if (!inspectResult || inspectResult.length === 0) {
        this.logger.warn(`[FRP Sync] docker.inspectContainers returned no data for container ${dbContainer.containerId}`);
        return null;
    }
    return inspectResult[0];
  }

  private async findConfigPath(host: HostWithCreds, inspectData: any, fileNames: string[]): Promise<string | null> {
    const mounts = inspectData?.Mounts as any[] || [];
    const triedPaths: string[] = [];
    for (const mount of mounts) {
        if (mount.Source) {
            for (const fileName of fileNames) {
                if (mount.Source.endsWith(fileName)) {
                    this.logger.log(`[FRP Sync] Found config file directly from mount source: ${mount.Source}`);
                    return mount.Source;
                }
                const potentialPath = path.join(mount.Source, fileName);
                triedPaths.push(potentialPath);
                this.logger.log(`[FRP Sync] Checking for config file at: ${potentialPath}`);
                const { code } = await this.docker.execShell({...host, port: host.port ?? undefined}, `test -f "${potentialPath}"`);
                if (code === 0) {
                    return potentialPath;
                }
            }
        }
    }
    this.logger.warn(`[FRP Sync] Could not find config file for container ${inspectData.Id}. Tried paths: ${triedPaths.join(', ')}`);
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