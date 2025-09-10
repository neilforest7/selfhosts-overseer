import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { CryptoService } from '../security/crypto.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { HostStatus } from '@prisma/client';

export interface HostItem {
  id: string;
  name: string;
  address: string;
  sshUser: string;
  port?: number;
  tags?: string[];
  role?: 'local' | 'remote';
  status: HostStatus;
  lastConnectivityCheck?: Date | null;
  sshOptions?: unknown;
  sshAuthMethod?: 'password' | 'privateKey';
  sshPassword?: string | null;
  sshPrivateKey?: string | null;
  sshPrivateKeyPassphrase?: string | null;
  hasPassword?: boolean;
  hasPrivateKey?: boolean;
}

@Injectable()
export class HostsService {
  private readonly logger = new Logger(HostsService.name);
  
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly crypto: CryptoService,
    private readonly activityLog: ActivityLogService,
  ) {
    this.logger.log('HostsService 初始化完成');
  }

  async list(tag?: string, limit?: number, cursor?: string): Promise<{ items: HostItem[]; nextCursor: string | null }> {
    const take = Math.min(100, Math.max(1, limit || 20));
    const records = await this.prisma.host.findMany({
      where: tag ? { tags: { has: tag } } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {})
    });
    const items = records.map(r => ({
      id: r.id,
      name: r.name,
      address: r.address,
      sshUser: r.sshUser,
      port: r.port ?? undefined,
      tags: r.tags,
      role: r.role as 'local' | 'remote',
      status: r.status,
      lastConnectivityCheck: r.lastConnectivityCheck,
      sshOptions: (r as any).sshOptions ?? undefined,
      sshAuthMethod: (r as any).sshAuthMethod ?? 'password',
      // 不透出明文与密文，仅提供存在标记
      sshPassword: null,
      sshPrivateKey: null,
      sshPrivateKeyPassphrase: null,
      hasPassword: Boolean((r as any).sshPassword),
      hasPrivateKey: Boolean((r as any).sshPrivateKey),
    }));
    return { items, nextCursor: records.length ? records[records.length - 1].id : null };
  }

  async findOne(id: string, includeCredentials = false): Promise<HostItem> {
    const host = await this.prisma.host.findUnique({ where: { id } });
    if (!host) {
      throw new Error(`Host with ID ${id} not found`);
    }
    
    const decryptedPassword = this.crypto.decryptString(host.sshPassword);
    const decryptedKey = this.crypto.decryptString(host.sshPrivateKey);
    const decryptedPassphrase = this.crypto.decryptString(host.sshPrivateKeyPassphrase);

    return {
      id: host.id,
      name: host.name,
      address: host.address,
      sshUser: host.sshUser,
      port: host.port ?? undefined,
      tags: host.tags,
      role: host.role as 'local' | 'remote',
      status: host.status,
      lastConnectivityCheck: host.lastConnectivityCheck,
      sshOptions: host.sshOptions as any,
      sshAuthMethod: host.sshAuthMethod as any,
      sshPassword: includeCredentials ? (decryptedPassword ? decryptedPassword.toString() : undefined) : null,
      sshPrivateKey: includeCredentials ? (decryptedKey ? decryptedKey.toString() : undefined) : null,
      sshPrivateKeyPassphrase: includeCredentials ? (decryptedPassphrase ? decryptedPassphrase.toString() : undefined) : null,
      hasPassword: !!host.sshPassword,
      hasPrivateKey: !!host.sshPrivateKey,
    };
  }

  async add(host: HostItem): Promise<HostItem> {
    this.logger.log(`创建新主机: ${host.name} (${host.address}:${host.port ?? 22})`);
    // 检查是否已存在相同地址和用户的主机
    const existing = await this.prisma.host.findFirst({
      where: { 
        address: host.address,
        sshUser: host.sshUser,
        port: host.port ?? null
      }
    });
    if (existing) {
      this.logger.warn(`主机创建失败: ${host.address} 已存在`);
      throw new Error(`主机 ${host.address} (用户: ${host.sshUser}, 端口: ${host.port ?? 22}) 已存在`);
    }

    const created = await this.prisma.host.create({
      data: {
        name: host.name,
        address: host.address,
        sshUser: host.sshUser,
        port: host.port ?? null,
        tags: host.tags ?? [],
        role: host.role,
        sshOptions: (host as any).sshOptions ?? undefined,
        sshAuthMethod: (host as any).sshAuthMethod ?? 'password',
        sshPassword: this.crypto.encryptString((host as any).sshPassword ?? null),
        sshPrivateKey: this.crypto.encryptString((host as any).sshPrivateKey ?? null),
        sshPrivateKeyPassphrase: this.crypto.encryptString((host as any).sshPrivateKeyPassphrase ?? null)
      }
    });
    this.logger.log(`✅ 主机创建成功: ${created.name} (ID: ${created.id})`);

    // Log activity
    await this.activityLog.logHostActivity(
      'created',
      created.id,
      created.name,
      `Host '${created.name}' created`,
      `New host added: ${created.address}:${created.port ?? 22} (${created.sshUser})`,
      {
        address: created.address,
        port: created.port ?? 22,
        sshUser: created.sshUser,
        role: created.role,
        tags: created.tags,
      }
    );

    return {
      id: created.id,
      name: created.name,
      address: created.address,
      sshUser: created.sshUser,
      port: created.port ?? undefined,
      tags: created.tags,
      role: created.role as 'local' | 'remote',
      sshOptions: (created as any).sshOptions ?? undefined,
      sshAuthMethod: (created as any).sshAuthMethod ?? 'password',
      hasPassword: Boolean((created as any).sshPassword),
      hasPrivateKey: Boolean((created as any).sshPrivateKey),
      status: 'UNKNOWN' as any, // Default status
    };
  }

  async update(id: string, partial: Partial<HostItem>): Promise<HostItem> {
    // Get original host for change tracking
    const original = await this.prisma.host.findUnique({ where: { id } });
    if (!original) {
      throw new Error(`Host with ID ${id} not found`);
    }

    const data: any = {
      name: partial.name ?? undefined,
      address: partial.address ?? undefined,
      sshUser: partial.sshUser ?? undefined,
      port: partial.port === undefined ? undefined : partial.port,
      tags: partial.tags ?? undefined,
      role: partial.role ?? undefined,
      sshOptions: (partial as any).sshOptions ?? undefined,
    };

    const hasNewPassword = typeof (partial as any).sshPassword === 'string' && (partial as any).sshPassword.length > 0;
    const hasNewPrivateKey = typeof (partial as any).sshPrivateKey === 'string' && (partial as any).sshPrivateKey.length > 0;

    if (hasNewPassword || hasNewPrivateKey) {
      this.logger.log(`正在为主机 ${id} 更新凭据`);
      data.sshAuthMethod = (partial as any).sshAuthMethod ?? undefined;
      data.sshPassword = this.crypto.encryptString((partial as any).sshPassword ?? null);
      data.sshPrivateKey = this.crypto.encryptString((partial as any).sshPrivateKey ?? null);
      data.sshPrivateKeyPassphrase = this.crypto.encryptString((partial as any).sshPrivateKeyPassphrase ?? null);
    }

    const updated = await this.prisma.host.update({
      where: { id },
      data,
    });

    // Log activity
    const changes = [];
    if (partial.name && partial.name !== original.name) changes.push(`name: ${original.name} → ${partial.name}`);
    if (partial.address && partial.address !== original.address) changes.push(`address: ${original.address} → ${partial.address}`);
    if (partial.sshUser && partial.sshUser !== original.sshUser) changes.push(`user: ${original.sshUser} → ${partial.sshUser}`);
    if (partial.port !== undefined && partial.port !== original.port) changes.push(`port: ${original.port ?? 22} → ${partial.port ?? 22}`);
    if (hasNewPassword || hasNewPrivateKey) changes.push('credentials updated');

    if (changes.length > 0) {
      await this.activityLog.logHostActivity(
        'updated',
        updated.id,
        updated.name,
        `Host '${updated.name}' updated`,
        `Changes: ${changes.join(', ')}`,
        {
          changes,
          hasCredentialUpdate: hasNewPassword || hasNewPrivateKey,
        },
        {
          name: original.name,
          address: original.address,
          sshUser: original.sshUser,
          port: original.port,
        },
        {
          name: updated.name,
          address: updated.address,
          sshUser: updated.sshUser,
          port: updated.port,
        }
      );
    }

    return {
      id: updated.id,
      name: updated.name,
      address: updated.address,
      sshUser: updated.sshUser,
      port: updated.port ?? undefined,
      tags: updated.tags,
      role: updated.role as 'local' | 'remote',
      sshOptions: (updated as any).sshOptions ?? undefined,
      sshAuthMethod: (updated as any).sshAuthMethod ?? 'password',
      sshPassword: null,
      sshPrivateKey: null,
      sshPrivateKeyPassphrase: null,
      hasPassword: Boolean((updated as any).sshPassword),
      hasPrivateKey: Boolean((updated as any).sshPrivateKey),
      status: 'UNKNOWN' as any, // Default status
    };
  }

  async remove(id: string): Promise<void> {
    this.logger.log(`开始删除主机: ${id}`);

    // Get host info before deletion for activity logging
    const host = await this.prisma.host.findUnique({ where: { id } });
    if (!host) {
      throw new Error(`Host with ID ${id} not found`);
    }

    // 使用事务确保数据一致性
    await this.prisma.$transaction(async (tx) => {
      // 1. 删除与该主机关联的容器记录
      const deletedContainers = await tx.container.deleteMany({
        where: { hostId: id }
      });
      this.logger.log(`删除了 ${deletedContainers.count} 个容器记录`);

      // 2. 删除与该主机关联的 FrpcProxy 记录
      const deletedFrpcProxies = await tx.frpcProxy.deleteMany({
        where: { hostId: id }
      });
      this.logger.log(`删除了 ${deletedFrpcProxies.count} 个 FrpcProxy 记录`);

      // 3. 删除与该主机关联的 FrpsConfig 记录
      const deletedFrpsConfigs = await tx.frpsConfig.deleteMany({
        where: { hostId: id }
      });
      this.logger.log(`删除了 ${deletedFrpsConfigs.count} 个 FrpsConfig 记录`);

      // 4. 删除与该主机关联的反向代理路由记录
      const deletedReverseProxyRoutes = await tx.reverseProxyRoute.deleteMany({
        where: { hostId: id }
      });
      this.logger.log(`删除了 ${deletedReverseProxyRoutes.count} 个反向代理路由记录`);

      // 5. 删除与该主机关联的 HostNpmConfig 记录
      const deletedHostNpmConfig = await tx.hostNpmConfig.deleteMany({
        where: { hostId: id }
      });
      this.logger.log(`删除了 ${deletedHostNpmConfig.count} 个 HostNpmConfig 记录`);

      // 6. 最后删除主机记录
      await tx.host.delete({ where: { id } });
      this.logger.log(`✅ 主机删除成功: ${id}`);
    });

    // Log activity
    await this.activityLog.logHostActivity(
      'deleted',
      id,
      host.name,
      `Host '${host.name}' deleted`,
      `Host removed: ${host.address}:${host.port ?? 22} (${host.sshUser})`,
      {
        address: host.address,
        port: host.port ?? 22,
        sshUser: host.sshUser,
        role: host.role,
        tags: host.tags,
      }
    );
  }

  async testConnection(id: string): Promise<{ ok: boolean; code: number; stdout?: string; stderr?: string }> {
    const h = await this.prisma.host.findUnique({ where: { id } });
    if (!h) return { ok: false, code: 1 };
    
    this.logger.log(`测试主机连接: ${h.name} (${h.address}:${h.port ?? 22})`);
    const usePassword = (h as any).sshAuthMethod === 'password';
    const useKey = (h as any).sshAuthMethod === 'privateKey';

    const decryptedPassword = this.crypto.decryptString((h as any).sshPassword ?? null);
    const decPassword = decryptedPassword ? decryptedPassword.toString() : undefined;

    const decryptedKey = this.crypto.decryptString((h as any).sshPrivateKey ?? null);
    const decKey = decryptedKey ? decryptedKey.toString() : undefined;

    const decryptedPassphrase = this.crypto.decryptString((h as any).sshPrivateKeyPassphrase ?? null);
    const decPassphrase = decryptedPassphrase ? decryptedPassphrase.toString() : undefined;
    const res = await this.ssh.executeCapture({
      host: h.address,
      user: h.sshUser,
      port: h.port ?? undefined,
      command: 'echo ok',
      connectTimeoutSeconds: 10,
      killAfterSeconds: 10,
      onStdout: () => {}, onStderr: () => {},
      password: usePassword ? decPassword : undefined,
      privateKey: useKey ? decKey : undefined,
      privateKeyPassphrase: useKey ? decPassphrase : undefined,
    });
    
    if (res.code === 0) {
      this.logger.log(`✅ 主机连接测试成功: ${h.name}`);
    } else {
      this.logger.warn(`❌ 主机连接测试失败: ${h.name} (退出码: ${res.code})`);
    }

    // Log activity
    await this.activityLog.logHostActivity(
      res.code === 0 ? 'connection_test_success' : 'connection_test_failed',
      h.id,
      h.name,
      `Connection test ${res.code === 0 ? 'succeeded' : 'failed'} for host '${h.name}'`,
      res.code === 0
        ? `Successfully connected to ${h.address}:${h.port ?? 22}`
        : `Failed to connect to ${h.address}:${h.port ?? 22} (exit code: ${res.code})`,
      {
        exitCode: res.code,
        address: h.address,
        port: h.port ?? 22,
        sshUser: h.sshUser,
        stdout: res.stdout.toString(),
        stderr: res.stderr.toString(),
      }
    );

    return { ok: res.code === 0, code: res.code, stdout: res.stdout.toString(), stderr: res.stderr.toString() };
  }

  /**
   * 清理孤立的反向代理路由记录
   * 删除那些 hostId 字段引用的主机在系统中不存在的记录
   */
  async cleanupOrphanedReverseProxyRoutes(): Promise<{ deletedCount: number }> {
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
}

