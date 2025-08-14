import { Injectable } from '@nestjs/common';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly crypto: CryptoService,
  ) {}

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
    // 检查是否已存在相同地址和用户的主机
    const existing = await this.prisma.host.findFirst({
      where: { 
        address: host.address,
        sshUser: host.sshUser,
        port: host.port ?? null
      }
    });
    if (existing) {
      throw new Error(`主机 ${host.address} (用户: ${host.sshUser}, 端口: ${host.port ?? 22}) 已存在`);
    }

    const created = await this.prisma.host.create({
      data: {
        name: host.name,
        address: host.address,
        sshUser: host.sshUser,
        port: host.port ?? null,
        tags: host.tags ?? [],
        sshOptions: (host as any).sshOptions ?? undefined,
        sshAuthMethod: (host as any).sshAuthMethod ?? 'password',
        sshPassword: this.crypto.encryptString((host as any).sshPassword ?? null),
        sshPrivateKey: this.crypto.encryptString((host as any).sshPrivateKey ?? null),
        sshPrivateKeyPassphrase: this.crypto.encryptString((host as any).sshPrivateKeyPassphrase ?? null)
      }
    });
    return {
      id: created.id,
      name: created.name,
      address: created.address,
      sshUser: created.sshUser,
      port: created.port ?? undefined,
      tags: created.tags,
      sshOptions: (created as any).sshOptions ?? undefined,
      sshAuthMethod: (created as any).sshAuthMethod ?? 'password',
      hasPassword: Boolean((created as any).sshPassword),
      hasPrivateKey: Boolean((created as any).sshPrivateKey),
    };
  }

  async update(id: string, partial: Partial<HostItem>): Promise<HostItem> {
    const updated = await this.prisma.host.update({
      where: { id },    
      data: {
        name: partial.name ?? undefined,
        address: partial.address ?? undefined,
        sshUser: partial.sshUser ?? undefined,
        port: partial.port === undefined ? undefined : partial.port,
        tags: partial.tags ?? undefined,
        sshOptions: (partial as any).sshOptions ?? undefined,
        sshAuthMethod: (partial as any).sshAuthMethod ?? undefined,
        sshPassword: (partial as any).sshPassword === undefined ? undefined : this.crypto.encryptString((partial as any).sshPassword),
        sshPrivateKey: (partial as any).sshPrivateKey === undefined ? undefined : this.crypto.encryptString((partial as any).sshPrivateKey),
        sshPrivateKeyPassphrase: (partial as any).sshPrivateKeyPassphrase === undefined ? undefined : this.crypto.encryptString((partial as any).sshPrivateKeyPassphrase)
      }
    });
    return {
      id: updated.id,
      name: updated.name,
      address: updated.address,
      sshUser: updated.sshUser,
      port: updated.port ?? undefined,
      tags: updated.tags,
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
    return { ok: res.code === 0, code: res.code, stdout: res.stdout, stderr: res.stderr };
  }
}

