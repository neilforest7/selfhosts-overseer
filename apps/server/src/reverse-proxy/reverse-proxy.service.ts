import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { Host } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SettingsService } from '../settings/settings.service';

type HostWithCreds = Host & {
  password?: string;
  privateKey?: string;
  privateKeyPassphrase?: string;
};

@Injectable()
export class ReverseProxyService {
  private readonly logger = new Logger(ReverseProxyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
  ) {}

  async listRoutes(params: { hostId?: string }) {
    return this.prisma.reverseProxyRoute.findMany({
      where: params.hostId ? { hostId: params.hostId } : undefined,
      orderBy: { domain: 'asc' },
      take: 500,
    });
  }

  async syncRoutesFromHost(hostId: string) {
    this.logger.log(`[NPM Sync] Task started for host: ${hostId}`);
    const host = await this.getHostWithCreds(hostId);
    if (!host) {
      this.logger.warn(`[NPM Sync] Host not found: ${hostId}`);
      return;
    }

    this.logger.log(`[NPM Sync] Starting sync for host: ${host.name} (${host.address})`);

    const npmContainer = await this.prisma.container.findFirst({
      where: { hostId, name: { contains: 'npm-app' } },
    });

    if (!npmContainer) {
      this.logger.log(`[NPM Sync] No NPM container found on host ${host.name}`);
      return;
    }
    this.logger.log(`[NPM Sync] Found NPM container: ${npmContainer.name} (${npmContainer.containerId})`);

    const dbPath = await this.findNpmDbPath(host, npmContainer.containerId);
    if (!dbPath) {
      this.logger.warn(`[NPM Sync] Could not find NPM database path for container ${npmContainer.name}`);
      return;
    }
    this.logger.log(`[NPM Sync] Found NPM database path: ${dbPath}`);

    const tempDbPath = path.join('/tmp', `npm_${Date.now()}.sqlite`);
    this.logger.log(`[NPM Sync] Downloading database to temporary path: ${tempDbPath}`);
    const downloaded = await this.downloadDbFile(host, dbPath, tempDbPath);
    if (!downloaded) {
      this.logger.warn(`[NPM Sync] Failed to download NPM database from ${dbPath}`);
      return;
    }
    this.logger.log(`[NPM Sync] Database downloaded successfully.`);

    const routes = await this.queryRoutesFromDb(tempDbPath);
    this.logger.log(`[NPM Sync] Found ${routes.length} routes in the database.`);
    await fs.unlink(tempDbPath);
    this.logger.log(`[NPM Sync] Deleted temporary database file: ${tempDbPath}`);

    const now = new Date();
    let upsertedCount = 0;

    for (const route of routes) {
      const domainsRaw = route.domain_names || '';
      let domainNames: string[] = [];

      // Nginx Proxy Manager can store domains as a JSON array string '["a.com","b.com"]'
      // or as a simple comma-separated string 'a.com,b.com'. We need to handle both.
      if (domainsRaw.startsWith('[') && domainsRaw.endsWith(']')) {
        try {
          domainNames = JSON.parse(domainsRaw);
        } catch (e) {
          // If JSON parsing fails, treat it as a string to be cleaned and split.
          this.logger.warn(`[NPM Sync] JSON parsing failed for '${domainsRaw}'. Falling back to string split.`);
          domainNames = domainsRaw.replace(/[\[\]"]/g, '').split(',').map(d => d.trim());
        }
      } else if (domainsRaw) {
        domainNames = domainsRaw.split(',').map(d => d.trim());
      }

      for (const domain of domainNames) {
        if (!domain) continue; // Skip empty entries
        const data = {
          hostId: host.id,
          provider: 'npm',
          type: 'http',
          domain,
          forwardHost: route.forward_host,
          forwardPort: route.forward_port,
          enabled: route.enabled === 1,
          certificateId: route.certificate_id?.toString(),
          sslForced: route.ssl_forced === 1,
          hstsEnabled: route.hsts_enabled === 1,
          hstsSubdomains: route.hsts_subdomains === 1,
          http2Support: route.http2_support === 1,
          allowWebsocketUpgrade: route.allow_websocket_upgrade === 1,
          blockExploits: route.block_exploits === 1,
          cachingEnabled: route.caching_enabled === 1,
          certExpiresAt: route.expires_on ? new Date(route.expires_on) : null,
          lastSyncedAt: now,
        };

        await this.prisma.reverseProxyRoute.upsert({
          where: { hostId_domain: { hostId: host.id, domain } },
          create: data,
          update: data,
        });
        upsertedCount++;
        this.logger.log(`[NPM Sync] Upserted route for domain: ${domain}`);
      }
    }
    this.logger.log(`[NPM Sync] Finished processing all routes. Upserted ${upsertedCount} routes.`);
  }

  private async findNpmDbPath(host: HostWithCreds, containerId: string): Promise<string | null> {
    const inspectData = await this.docker.inspectContainers({ ...host, port: host.port ?? undefined }, [containerId]);
    if (!inspectData || inspectData.length === 0) return null;

    const composeFiles = inspectData[0].Config?.Labels?.['com.docker.compose.project.config_files'];
    if (composeFiles) {
      const composePath = path.dirname(composeFiles.split(',')[0]);
      const composeContent = await this.readRemoteFile(host, path.join(composePath, 'docker-compose.yml'));
      if (composeContent) {
        const dbVolumeMatch = composeContent.toString().match(/-(.*)\:\/data/);
        if (dbVolumeMatch && dbVolumeMatch[1]) {
          return path.join(path.dirname(composePath), dbVolumeMatch[1].trim(), 'database.sqlite');
        }
      }
    }

    const mounts = inspectData[0].Mounts || [];
    for (const mount of mounts) {
      if (mount.Destination === '/data') {
        return path.join(mount.Source, 'database.sqlite');
      }
    }

    return null;
  }

  private async downloadDbFile(host: HostWithCreds, remotePath: string, localPath: string): Promise<boolean> {
    try {
      const content = await this.readRemoteFile(host, remotePath, 'binary');
      if (content) {
        await fs.writeFile(localPath, content, 'binary');
        return true;
      }
      return false;
    } catch (e: any) {
      this.logger.error(`[NPM Sync] Error downloading DB file: ${e.message}`);
      return false;
    }
  }

  private async queryRoutesFromDb(dbPath: string): Promise<any[]> {
    const sqlite3 = await import('sqlite3').then(m => m.default);
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    return new Promise((resolve, reject) => {
      const query = `
        SELECT 
          ph.*,
          c.expires_on
        FROM proxy_host ph
        LEFT JOIN certificate c ON ph.certificate_id = c.id
      `;
      db.all(query, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
        db.close();
      });
    });
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

  private async readRemoteFile(host: HostWithCreds, filePath: string, encoding: 'utf8' | 'binary' = 'utf8'): Promise<string | Buffer | null> {
    try {
      const { stdout } = await this.docker.execShell({...host, port: host.port ?? undefined}, `cat "${filePath}"`, { encoding });
      return stdout;
    } catch (e: any) {
      this.logger.warn(`[NPM Sync] Failed to read remote file ${filePath} on host ${host.name}. Error: ${e.message}`);
      return null;
    }
  }
}
