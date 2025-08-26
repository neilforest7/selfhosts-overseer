import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { Host } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SettingsService } from '../settings/settings.service';
import { OperationLogService } from '../operation-log/operation-log.service';

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
    private readonly operationLogService: OperationLogService,
  ) {}

  async listRoutes(params: { hostId?: string }) {
    return this.prisma.reverseProxyRoute.findMany({
      where: params.hostId ? { hostId: params.hostId } : undefined,
      orderBy: { domain: 'asc' },
      take: 500,
    });
  }

  async syncRoutesFromHost(hostId: string, opId?: string): Promise<void> {
    const isStandaloneAction = !opId;
    let effectiveOpId = opId;
    let isFailed = false;

    if (isStandaloneAction) {
      const opLog = await this.operationLogService.create({ title: `Sync Reverse Proxy Routes from host ${hostId}` });
      effectiveOpId = opLog.id;
    }

    const log = async (stream: 'system' | 'info' | 'error', content: string) => {
      await this.operationLogService.addLogEntry(effectiveOpId, { stream, content, hostId });
    };

    try {
      const host = await this.getHostWithCreds(hostId);
      if (!host) throw new Error(`Host not found: ${hostId}`);

      await log('system', `Starting NPM sync for host: ${host.name} (${host.address})`);

      const npmContainer = await this.prisma.container.findFirst({
        where: { hostId, name: { contains: 'npm-app' } },
      });

      if (!npmContainer) throw new Error(`No NPM container found on host ${host.name}`);
      
      await log('info', `Found NPM container: ${npmContainer.name} (${npmContainer.containerId})`);

      const inspectData = await this.docker.inspectContainers({ ...host, port: host.port ?? undefined }, [npmContainer.containerId]);
      if (!inspectData || inspectData.length === 0) {
        throw new Error(`Could not inspect NPM container ${npmContainer.name}`);
      }

      const envVars = this.parseEnvArray(inspectData[0].Config.Env);
      let routes = [];

      if (envVars['DB_MYSQL_HOST']) {
        await log('info', 'Detected MySQL/MariaDB configuration.');
        routes = await this.syncFromMysql(host, inspectData[0], envVars, log);
      } else {
        await log('info', 'Detected SQLite configuration.');
        routes = await this.syncFromSqlite(host, inspectData[0], log);
      }

      if (!routes) throw new Error('Failed to retrieve routes from NPM.');

      await log('info', `Found ${routes.length} routes in the database.`);
      const now = new Date();
      let upsertedCount = 0;

      for (const route of routes) {
        const domainsRaw = route.domain_names || '';
        let domainNames: string[] = [];
        if (domainsRaw.startsWith('[') && domainsRaw.endsWith(']')) {
          try {
            domainNames = JSON.parse(domainsRaw);
          } catch (e) {
            domainNames = domainsRaw.replace(/[[\\\]\\"]/g, '').split(',').map(d => d.trim());
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
        }
      }
      await log('system', `Finished processing all routes. Upserted ${upsertedCount} routes.`);
    } catch (err) {
      isFailed = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      await log('error', `NPM sync failed: ${errorMessage}`);
    } finally {
      if (isStandaloneAction) {
        await this.operationLogService.updateStatus(effectiveOpId, isFailed ? 'ERROR' : 'COMPLETED');
      }
    }
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

  private async syncFromSqlite(host: HostWithCreds, npmContainerInspect: any, log: (stream: 'info' | 'error', content: string) => Promise<void>): Promise<any[] | null> {
    const dbPath = await this.findNpmDbPath(host, npmContainerInspect);
    if (!dbPath) {
      await log('error', `Could not find NPM database path for container ${npmContainerInspect.Name}`);
      return null;
    }
    await log('info', `Found NPM database path: ${dbPath}`);

    const tempDbPath = path.join('/tmp', `npm_${Date.now()}.sqlite`);
    const downloaded = await this.downloadDbFile(host, dbPath, tempDbPath);
    if (!downloaded) {
      await log('error', `Failed to download NPM database from ${dbPath}`);
      return null;
    }

    const routes = await this.queryRoutesFromSqliteDb(tempDbPath);
    await fs.unlink(tempDbPath);
    return routes;
  }

  private async syncFromMysql(host: HostWithCreds, npmContainerInspect: any, envVars: { [key: string]: string }, log: (stream: 'info' | 'error', content: string) => Promise<void>): Promise<any[] | null> {
    const dbHostService = envVars['DB_MYSQL_HOST'];
    const user = envVars['DB_MYSQL_USER'];
    const password = envVars['DB_MYSQL_PASSWORD'];
    const database = envVars['DB_MYSQL_NAME'];
    const query = `SELECT ph.*, c.expires_on FROM proxy_host ph LEFT JOIN certificate c ON ph.certificate_id = c.id`;

    const networks = npmContainerInspect.NetworkSettings?.Networks;
    const networkName = networks ? Object.keys(networks)[0] : null;
    if (!networkName) {
      await log('error', `Could not determine the network for the NPM container.`);
      return null;
    }

    const mysqlCommand = `mysql -h '${dbHostService}' -u'${user}' --password='${password}' '${database}' -e "${query}"`;
    const runCommand = `docker run --rm --network ${networkName} mysql:8 ${mysqlCommand}`;

    const { code, stdout, stderr } = await this.docker.execShell({ ...host, port: host.port ?? undefined }, runCommand);

    if (code !== 0) {
      await log('error', `Failed to execute mysql query in temporary container. Exit code: ${code}, Stderr: ${stderr.toString()}`);
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
