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

    const inspectData = await this.docker.inspectContainers({ ...host, port: host.port ?? undefined }, [npmContainer.containerId]);
    if (!inspectData || inspectData.length === 0) {
      this.logger.warn(`[NPM Sync] Could not inspect NPM container ${npmContainer.name}`);
      return;
    }

    const envVars = this.parseEnvArray(inspectData[0].Config.Env);
    let routes = [];

    if (envVars['DB_MYSQL_HOST']) {
      this.logger.log('[NPM Sync] Detected MySQL/MariaDB configuration.');
      routes = await this.syncFromMysql(host, inspectData[0], envVars);
    } else {
      this.logger.log('[NPM Sync] Detected SQLite configuration.');
      routes = await this.syncFromSqlite(host, inspectData[0]);
    }

    if (!routes) {
      this.logger.error('[NPM Sync] Failed to retrieve routes from NPM.');
      return;
    }

    this.logger.log(`[NPM Sync] Found ${routes.length} routes in the database.`);
    const now = new Date();
    let upsertedCount = 0;

    for (const route of routes) {
      const domainsRaw = route.domain_names || '';
      let domainNames: string[] = [];

      if (domainsRaw.startsWith('[') && domainsRaw.endsWith(']')) {
        try {
          domainNames = JSON.parse(domainsRaw);
        } catch (e) {
          this.logger.warn(`[NPM Sync] JSON parsing failed for '${domainsRaw}'. Falling back to string split.`);
          domainNames = domainsRaw.replace(/[\[\]"]/g, '').split(',').map(d => d.trim());
        }
      } else if (domainsRaw) {
        domainNames = domainsRaw.split(',').map(d => d.trim());
      }

      for (const domain of domainNames) {
        if (!domain) continue;
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

  private parseEnvArray(env: string[]): { [key: string]: string } {
    const result: { [key: string]: string } = {};
    for (const item of env) {
      const [key, ...valueParts] = item.split('=');
      if (key) {
        result[key] = valueParts.join('=');
      }
    }
    return result;
  }

  private async syncFromSqlite(host: HostWithCreds, npmContainerInspect: any): Promise<any[] | null> {
    const dbPath = await this.findNpmDbPath(host, npmContainerInspect);
    if (!dbPath) {
      this.logger.warn(`[NPM Sync] Could not find NPM database path for container ${npmContainerInspect.Name}`);
      return null;
    }
    this.logger.log(`[NPM Sync] Found NPM database path: ${dbPath}`);

    const tempDbPath = path.join('/tmp', `npm_${Date.now()}.sqlite`);
    this.logger.log(`[NPM Sync] Downloading database to temporary path: ${tempDbPath}`);
    const downloaded = await this.downloadDbFile(host, dbPath, tempDbPath);
    if (!downloaded) {
      this.logger.warn(`[NPM Sync] Failed to download NPM database from ${dbPath}`);
      return null;
    }
    this.logger.log(`[NPM Sync] Database downloaded successfully.`);

    const routes = await this.queryRoutesFromSqliteDb(tempDbPath);
    await fs.unlink(tempDbPath);
    this.logger.log(`[NPM Sync] Deleted temporary database file: ${tempDbPath}`);
    return routes;
  }

  private async syncFromMysql(host: HostWithCreds, npmContainerInspect: any, envVars: { [key: string]: string }): Promise<any[] | null> {
    const dbHostService = envVars['DB_MYSQL_HOST'];
    const user = envVars['DB_MYSQL_USER'];
    const password = envVars['DB_MYSQL_PASSWORD'];
    const database = envVars['DB_MYSQL_NAME'];
    const query = `SELECT ph.*, c.expires_on FROM proxy_host ph LEFT JOIN certificate c ON ph.certificate_id = c.id`;

    // Find the network the NPM container is on
    const networks = npmContainerInspect.NetworkSettings?.Networks;
    const networkName = networks ? Object.keys(networks)[0] : null;
    if (!networkName) {
      this.logger.error(`[NPM Sync] Could not determine the network for the NPM container.`);
      return null;
    }
    this.logger.log(`[NPM Sync] NPM container is on network: ${networkName}`);

    // Use a temporary mysql container on the same network to run the query.
    // The --password argument is used for direct, reliable authentication.
    const mysqlCommand = `mysql -h '${dbHostService}' -u'${user}' --password='${password}' '${database}' -e "${query}"`;
    const runCommand = `docker run --rm --network ${networkName} mysql:8 ${mysqlCommand}`;

    this.logger.log(`[NPM Sync] Executing command on host ${host.name} via temporary container.`);
    const { code, stdout, stderr } = await this.docker.execShell({ ...host, port: host.port ?? undefined }, runCommand);

    if (code !== 0) {
      this.logger.error(`[NPM Sync] Failed to execute mysql query in temporary container. Exit code: ${code}, Stderr: ${stderr.toString()}`);
      return null;
    }

    return this.parseMysqlOutput(stdout.toString());
  }

  private parseMysqlOutput(output: string): any[] {
    const lines = output.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split('\t');
    const rows = lines.slice(1);

    return rows.map(row => {
      const values = row.split('\t');
      const obj: { [key: string]: any } = {};
      headers.forEach((header, i) => {
        const value = values[i];
        if (value === 'NULL') {
          obj[header] = null;
        } else if (/^\d+$/.test(value) && header.endsWith('_port')) {
          obj[header] = parseInt(value, 10);
        } else if (/^\d+$/.test(value)) {
          // Simple numeric check for fields like 'enabled', 'ssl_forced' etc.
          obj[header] = parseInt(value, 10);
        } else {
          obj[header] = value;
        }
      });
      return obj;
    });
  }

  private async findNpmDbPath(host: HostWithCreds, npmContainerInspect: any): Promise<string | null> {
    const composeFiles = npmContainerInspect.Config?.Labels?.['com.docker.compose.project.config_files'];
    if (composeFiles) {
      const composePath = path.dirname(composeFiles.split(',')[0]);
      const composeContent = await this.readRemoteFile(host, path.join(composePath, 'docker-compose.yml'));
      if (composeContent) {
        const dbVolumeMatch = composeContent.toString().match(/-(.*):\/data/);
        if (dbVolumeMatch && dbVolumeMatch[1]) {
          return path.join(path.dirname(composePath), dbVolumeMatch[1].trim(), 'database.sqlite');
        }
      }
    }

    const mounts = npmContainerInspect.Mounts || [];
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

  private async queryRoutesFromSqliteDb(dbPath: string): Promise<any[]> {
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

  // private async queryRoutesFromMysqlDb(config: mysql.ConnectionOptions): Promise<any[] | null> {
  //   let connection: mysql.Connection | null = null;
  //   try {
  //     connection = await mysql.createConnection(config);
  //     this.logger.log('[NPM Sync] Successfully connected to MySQL/MariaDB database.');
  //     const query = `
  //       SELECT 
  //         ph.*,
  //         c.expires_on
  //       FROM proxy_host ph
  //       LEFT JOIN certificate c ON ph.certificate_id = c.id
  //     `;
  //     const [rows] = await connection.execute(query);
  //     return rows as any[];
  //   } catch (e: any) {
  //     this.logger.error(`[NPM Sync] Failed to query routes from MySQL/MariaDB: ${e.message}`);
  //     return null;
  //   } finally {
  //     if (connection) {
  //       await connection.end();
  //       this.logger.log('[NPM Sync] MySQL/MariaDB connection closed.');
  //     }
  //   }
  // }

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
