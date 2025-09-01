import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from '../containers/docker.service';
import { CryptoService } from '../security/crypto.service';
import { Host } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SettingsService } from '../settings/settings.service';
import { OperationLogService } from '../operation-log/operation-log.service';
import { ContextService } from '../context/context.service';

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
    private readonly contextService: ContextService,
  ) {}

  async listRoutes(params: { hostId?: string }) {
    return this.prisma.reverseProxyRoute.findMany({
      where: params.hostId ? { hostId: params.hostId } : undefined,
      orderBy: { domain: 'asc' },
      take: 500,
    });
  }

  async syncRoutesFromHost(hostId: string): Promise<void> {
    const existingOpId = this.contextService.getOpId();
    if (existingOpId) {
      return this.runSyncLogic(hostId);
    } else {
      const opLog = await this.operationLogService.create({ title: `Sync Reverse Proxy Routes from host ${hostId}` });
      return this.contextService.run(opLog.id, () => this.runSyncLogic(hostId, opLog.id));
    }
  }

  private async runSyncLogic(hostId: string, opId?: string): Promise<void> {
    let isFailed = false;
    try {
      const host = await this.getHostWithCreds(hostId);
      if (!host) throw new Error(`Host not found: ${hostId}`);

      this.operationLogService.log('system', `Starting NPM sync for host: ${host.name} (${host.address})`, hostId);

      const npmContainer = await this.prisma.container.findFirst({
        where: { hostId, name: { contains: 'npm-app' } },
      });

      if (!npmContainer) {
        this.operationLogService.log('info', `No NPM container found on host ${host.name}, skipping sync.`, hostId);
        return;
      }

      this.operationLogService.log('info', `Found NPM container: ${npmContainer.name} (${npmContainer.containerId})`);

    const inspectData = await this.docker.inspectContainers(
      { ...host, port: host.port ?? undefined },
      [npmContainer.containerId || ''],
    );
    if (!inspectData || inspectData.length === 0) {
      throw new Error(`Could not inspect NPM container ${npmContainer.name}`);
    }

    const envVars = this.parseEnvArray(inspectData[0].Config.Env);
    let routes: any[] | null = [];

    if (envVars['DB_MYSQL_HOST']) {
      this.operationLogService.log('info', 'Detected MySQL/MariaDB configuration.');
      routes = await this.syncFromMysql(host, inspectData[0], envVars);
    } else {
      this.operationLogService.log('info', 'Detected SQLite configuration.');
      routes = await this.syncFromSqlite(host, inspectData[0]);
    }

    if (!routes) throw new Error('Failed to retrieve routes from NPM.');

      this.operationLogService.log('info', `Found ${routes.length} routes in the database.`);
    const now = new Date();
    let upsertedCount = 0;

    for (const route of routes) {
      const domainsRaw = route.domain_names || '';
      let domainNames: string[] = [];
      if (domainsRaw.startsWith('[') && domainsRaw.endsWith(']')) {
        try {
          domainNames = JSON.parse(domainsRaw);
        } catch (e) {
          domainNames = domainsRaw.replace(/[[\]"]/g, '').split(',').map((d: any) => d.trim());
        }
      } else if (domainsRaw) {
        domainNames = domainsRaw.split(',').map((d: any) => d.trim());
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
      this.operationLogService.log('system', `Finished processing all routes. Upserted ${upsertedCount} routes.`);
    } catch (err) {
      isFailed = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.operationLogService.log('error', `NPM sync failed: ${errorMessage}`, hostId);
    } finally {
      if (opId) {
        await this.operationLogService.updateStatus(opId, isFailed ? 'ERROR' : 'COMPLETED');
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

  private async syncFromSqlite(host: HostWithCreds, npmContainerInspect: any): Promise<any[] | null> {
    const dbPath = await this.findNpmDbPath(host, npmContainerInspect);
    if (!dbPath) {
      this.operationLogService.log('error', `Could not find NPM database path for container ${npmContainerInspect.Name}`);
      return null;
    }
    this.operationLogService.log('info', `Found NPM database path: ${dbPath}`);

    const tempDbPath = path.join('/tmp', `npm_${Date.now()}.sqlite`);
    const downloaded = await this.downloadDbFile(host, dbPath, tempDbPath);
    if (!downloaded) {
      this.operationLogService.log('error', `Failed to download NPM database from ${dbPath}`);
      return null;
    }

    const routes = await this.queryRoutesFromSqliteDb(tempDbPath);
    await fs.unlink(tempDbPath);
    return routes;
  }

  private async syncFromMysql(host: HostWithCreds, npmContainerInspect: any, envVars: { [key: string]: string }): Promise<any[] | null> {
    const dbHostService = envVars['DB_MYSQL_HOST'];
    const user = envVars['DB_MYSQL_USER'];
    const password = envVars['DB_MYSQL_PASSWORD'];
    const database = envVars['DB_MYSQL_NAME'];
    const query = `SELECT ph.*, c.expires_on FROM proxy_host ph LEFT JOIN certificate c ON ph.certificate_id = c.id`;

    const networks = npmContainerInspect.NetworkSettings?.Networks;
    const networkName = networks ? Object.keys(networks)[0] : null;
    if (!networkName) {
      this.operationLogService.log('error', `Could not determine the network for the NPM container.`);
      return null;
    }

    const mysqlCommand = `mysql -h '${dbHostService}' -u'${user}' --password='${password}' '${database}' -e "${query}"`;
    const runCommand = `docker run --rm --network ${networkName} mysql:8 ${mysqlCommand}`;

    const { code, stdout, stderr } = await this.docker.execShell({ ...host, port: host.port ?? undefined }, runCommand);

    if (code !== 0) {
      this.operationLogService.log('error', `Failed to execute mysql query in temporary container. Exit code: ${code}, Stderr: ${stderr.toString()}`);
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
    const labels = npmContainerInspect.Config?.Labels || {};
    const composeFiles = labels['com.docker.compose.project.config_files'];
    const workingDir = labels['com.docker.compose.project.working_dir'];

    if (composeFiles && workingDir) {
      const composePath = composeFiles.split(',')[0];
      const composeContent = await this.readRemoteFile(host, composePath);
      if (composeContent) {
        // Match volumes like: ./data:/data, ./data:/data:ro, data:/data
        const dbVolumeMatch = composeContent.toString().match(/['"]?(\.?\.\/.*?)['"]?:['"]?\/data['"]?/);
        if (dbVolumeMatch && dbVolumeMatch[1]) {
          const relativePath = dbVolumeMatch[1].trim();
          // The path is relative to the compose working directory
          return path.join(workingDir, relativePath, 'database.sqlite');
        }
      }
    }

    // Fallback to inspecting mounts if compose labels are not sufficient
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

  private async readRemoteFile(
    host: HostWithCreds,
    filePath: string,
    encoding: 'utf8' | 'binary' = 'utf8',
  ): Promise<string | Buffer | null> {
    try {
      const { stdout } = await this.docker.execShell({ ...host, port: host.port ?? undefined }, `cat "${filePath}"`, {
        encoding,
      } as any);
      return stdout;
    } catch (e: any) {
      this.logger.warn(`[NPM Sync] Failed to read remote file ${filePath} on host ${host.name}. Error: ${e.message}`);
      return null;
    }
  }

  /**
   * 清理孤立的反向代理路由记录
   * 这个方法可以作为维护任务定期执行
   */
  async cleanupOrphanedRoutes(): Promise<{ deletedCount: number }> {
    this.logger.log('开始清理孤立的反向代理路由记录');

    try {
      // 使用子查询找到所有孤立的路由记录
      const orphanedRoutes = await this.prisma.$queryRaw<Array<{ id: string; hostId: string; domain: string }>>`
        SELECT rpr.id, rpr."hostId", rpr.domain
        FROM "ReverseProxyRoute" rpr
        LEFT JOIN "Host" h ON rpr."hostId" = h.id
        WHERE h.id IS NULL
      `;

      if (orphanedRoutes.length === 0) {
        this.logger.log('没有发现孤立的反向代理路由记录');
        return { deletedCount: 0 };
      }

      this.logger.log(`发现 ${orphanedRoutes.length} 个孤立的反向代理路由记录`);

      // 删除孤立的记录
      const deleteResult = await this.prisma.reverseProxyRoute.deleteMany({
        where: {
          id: {
            in: orphanedRoutes.map(route => route.id)
          }
        }
      });

      this.logger.log(`✅ 成功清理了 ${deleteResult.count} 个孤立的反向代理路由记录`);

      // 记录被删除的路由信息
      orphanedRoutes.forEach(route => {
        this.logger.log(`删除孤立路由: ${route.domain} (hostId: ${route.hostId})`);
      });

      return { deletedCount: deleteResult.count };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`清理孤立反向代理路由记录时发生错误: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * 同步路由时自动清理孤立记录
   * 可以在同步完成后调用此方法
   */
  async syncAndCleanup(hostId?: string): Promise<void> {
    if (hostId) {
      await this.syncRoutesFromHost(hostId);
    }

    // 同步完成后清理孤立记录
    const result = await this.cleanupOrphanedRoutes();
    if (result.deletedCount > 0) {
      this.logger.log(`同步后清理: 删除了 ${result.deletedCount} 个孤立的反向代理路由记录`);
    }
  }
}
