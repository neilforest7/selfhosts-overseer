import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { CryptoService } from '../security/crypto.service';

export interface HostItem {
  id: string;
  name: string;
  address: string;
  sshUser: string;
  port?: number;
  tags?: string[];
  role?: 'local' | 'remote';
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
    };
  }

  async update(id: string, partial: Partial<HostItem>): Promise<HostItem> {
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
      hasPrivateKey: Boolean((updated as any).sshPrivateKey)
    };
  }

  async remove(id: string): Promise<void> {
    await this.prisma.host.delete({ where: { id } });
  }

  async testConnection(id: string): Promise<{ ok: boolean; code: number; stdout?: string; stderr?: string }> {
    const h = await this.prisma.host.findUnique({ where: { id } });
    if (!h) return { ok: false, code: 1 };
    
    this.logger.log(`测试主机连接: ${h.name} (${h.address}:${h.port ?? 22})`);
    const usePassword = (h as any).sshAuthMethod === 'password';
    const useKey = (h as any).sshAuthMethod === 'privateKey';
    const decPassword = this.crypto.decryptString((h as any).sshPassword ?? null) ?? undefined;
    const decKey = this.crypto.decryptString((h as any).sshPrivateKey ?? null) ?? undefined;
    const decPassphrase = this.crypto.decryptString((h as any).sshPrivateKeyPassphrase ?? null) ?? undefined;
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
    
    return { ok: res.code === 0, code: res.code, stdout: res.stdout, stderr: res.stderr };
  }
}

