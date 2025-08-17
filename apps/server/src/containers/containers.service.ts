import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { ExecGateway } from '../realtime/exec.gateway';
import { CryptoService } from '../security/crypto.service';
import { LogsService } from '../logs/logs.service';

@Injectable()
export class ContainersService {
  private readonly logger = new Logger(ContainersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly gateway: ExecGateway,
    private readonly crypto: CryptoService,
    private readonly logs: LogsService,
  ) {}

  async list(params: { hostId?: string; hostName?: string; q?: string; updateAvailable?: boolean | undefined; isComposeManaged?: boolean | undefined }) {
    const where: any = {};
    
    // 支持按主机ID或主机名过滤
    if (params.hostId) {
      where.hostId = params.hostId;
    } else if (params.hostName) {
      const host = await this.prisma.host.findFirst({ where: { name: params.hostName } });
      if (host) {
        where.hostId = host.id;
      } else {
        return { items: [] }; // 找不到主机，返回空结果
      }
    }
    
    if (typeof params.updateAvailable === 'boolean') where.updateAvailable = params.updateAvailable;
    if (typeof params.isComposeManaged === 'boolean') where.isComposeManaged = params.isComposeManaged;
    if (params.q) where.OR = [{ name: { contains: params.q } }, { imageName: { contains: params.q } }];
    
    const items = await this.prisma.container.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 });
    return { items };
  }

  async discoverOnHost(host: { id: string; address: string; sshUser: string; port?: number }, opId?: string): Promise<number> {
    await this.logs.addLog('info', `开始发现主机 ${host.address} 上的容器`, 'container', { 
      source: 'containers', 
      hostId: host.id, 
      hostLabel: `${host.address}`,
      metadata: { operation: 'discover' }
    });
    
    // 1) docker ps -a --format '{{json .}}'
    const h = await this.prisma.host.findUnique({ where: { id: host.id } });
    const decPassword = this.crypto?.decryptString((h as any)?.sshPassword ?? null) ?? undefined;
    const decKey = this.crypto?.decryptString((h as any)?.sshPrivateKey ?? null) ?? undefined;
    const decPassphrase = this.crypto?.decryptString((h as any)?.sshPrivateKeyPassphrase ?? null) ?? undefined;
    const hostCred = { ...host, password: decPassword, privateKey: decKey, privateKeyPassphrase: decPassphrase } as any;
    // 使用最基础的docker ps命令，然后手动解析
    const { code, stdout, stderr, cmd } = await this.docker.exec(hostCred, ['ps', '-a'], 60);
    await this.logs.addLog('info', `[${host.address}] ${cmd}`, 'container', { 
      source: 'containers', 
      hostId: host.id, 
      hostLabel: host.address,
      metadata: { command: cmd, operation: 'docker_ps' }
    });
    
    if (code !== 0) {
      this.logger.warn(`docker ps failed on ${host.address}: ${stderr}`);
      await this.logs.addLog('error', `[${host.address}] 退出码: ${code} - ${stderr}`, 'container', { 
        source: 'containers', 
        hostId: host.id, 
        hostLabel: host.address,
        metadata: { command: cmd, exitCode: code, stderr, operation: 'docker_ps' }
      });
      if (opId) this.gateway.broadcast(opId, 'stderr', `[${host.address}] ${cmd}\n退出码: ${code}\n${stderr}`);
      return 0;
    }
    
    await this.logs.addLog('info', `[${host.address}] 退出码: ${code}`, 'container', { 
      source: 'containers', 
      hostId: host.id, 
      hostLabel: host.address,
      metadata: { command: cmd, exitCode: code, operation: 'docker_ps' }
    });
    if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] ${cmd}\n退出码: ${code}`);
    const lines = stdout.split('\n').filter(Boolean);
    const briefList: { id: string; name: string; image: string; state?: string; status?: string; restartCount?: number }[] = [];
    let upserted = 0;
    // 跳过标题行，解析标准docker ps输出
    for (const line of lines.slice(1)) {
      try {
        // 使用正则表达式解析固定宽度的docker ps输出
        // 格式: CONTAINER ID   IMAGE     COMMAND   CREATED   STATUS   PORTS   NAMES
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 7) {
          const containerId = parts[0];
          const image = parts[1];
          const name = parts[parts.length - 1]; // NAMES是最后一列
          
          // 提取STATUS列（通常在倒数第二或第三列）
          let status = '';
          for (let i = 4; i < parts.length - 1; i++) {
            if (parts[i].includes('Up') || parts[i].includes('Exited') || parts[i].includes('Created')) {
              status = parts.slice(i, parts.length - 1).join(' ');
              break;
            }
          }
          
          if (containerId && name && containerId !== 'CONTAINER') {
            briefList.push({ 
              id: containerId.trim(), 
              name: name.trim(), 
              image: image.trim(), 
              state: status.includes('Up') ? 'running' : 'exited',
              status: status.trim()
            });
          }
        }
      } catch (e) {
        // 如果解析失败，尝试简单的空格分割
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2 && parts[0] !== 'CONTAINER') {
          briefList.push({ 
            id: parts[0].trim(), 
            name: parts[parts.length - 1].trim(), 
            image: parts[1] || '', 
            state: 'unknown',
            status: ''
          });
        }
      }
    }
    // 2) docker inspect 进一步采集详细信息
    const details = await this.docker.inspectContainers(hostCred, briefList.map(b => b.id));
    const detailById = new Map<string, any>();
    // 使用完整ID和短ID都作为键，确保能匹配
    for (const d of details) {
      if (d?.Id) {
        detailById.set(d.Id, d);  // 完整ID
        detailById.set(d.Id.slice(0, 12), d);  // 短ID
      }
    }
    const seenIds = new Set<string>();
    for (const b of briefList) {
      const det = detailById.get(b.id) || {};
      const config = det.Config || {};
      const hostConfig = det.HostConfig || {};
      const networkSettings = det.NetworkSettings || {};
      const state = det.State || {};
      const createdAt = det.Created ? new Date(det.Created) : undefined;
      const startedAt = state.StartedAt ? new Date(state.StartedAt) : undefined;
      const ports = Object.entries((networkSettings.Ports || {})).map(([k, v]: any) => ({ key: k, bindings: v }));
      const mounts = Array.isArray(det.Mounts) ? det.Mounts : [];
      const networks = networkSettings.Networks || {};
      const labels = config.Labels || {};
      const imageRef = config.Image || b.image || '';
      const { imageName, imageTag } = await this.docker.resolveImageNameTag(hostCred, imageRef);
      
      // 获取容器实际运行的镜像 digest（从 docker inspect 的 Image 字段）
      const actualImageDigest = await this.docker.getContainerImageDigest(hostCred, det.Id || b.id);
      
      // 获取容器的平台信息
      const platformInfo = await this.docker.getContainerPlatform(hostCred, det.Id || b.id);
      
      // 保留原有的 repoDigests 作为备用
      const repoDigests = imageRef ? await this.docker.inspectImageRepoDigests(hostCred, imageRef) : [];
      
      const fullId: string = det.Id || b.id;
      const shortId: string = fullId.slice(0, 12);
      if (fullId) { seenIds.add(fullId); }
      if (shortId) { seenIds.add(shortId); }
      if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] 发现容器 ${b.name} (${shortId}) - ${(imageName || '')}:${(imageTag || '')}`);

      // 统一短ID与完整ID，修复历史重复
      const existing = await this.prisma.container.findFirst({ where: { hostId: host.id, containerId: { in: [fullId, shortId, b.id] } } });
      const composeWorkingDir = (labels as any)['com.docker.compose.project.working_dir'] || null;
      const composeProject = (labels as any)['com.docker.compose.project'] || null;
      const composeService = (labels as any)['com.docker.compose.service'] || null;
      

      const composeFolderName = (() => {
        const wd = composeWorkingDir || '';
        const parts = wd.split(/[/\\]+/).filter(Boolean);
        return parts.length ? parts[parts.length - 1] : (composeProject || null);
      })();
      // 统一以 composeProject 作为分组键，避免 working_dir 差异造成分裂
      const composeGroupKey = composeProject ? `${host.id}::compose::${composeProject}` : null;

      const commonData = {
        name: b.name,
        state: b.state ?? state.Status,
        status: b.status ?? state.Status,
        imageName,
        imageTag,
        // 优先使用实际镜像digest，fallback到repoDigest
        repoDigest: actualImageDigest || (Array.isArray(repoDigests) && repoDigests.length ? String(repoDigests[0]) : null),
        startedAt: startedAt ?? undefined,
        ports,
        mounts,
        networks,
        labels: {
          ...labels,
          // 添加平台信息到labels中，以便后续使用
          ...(platformInfo.architecture && !platformInfo.error ? { '__platform_arch': platformInfo.architecture } : {}),
          ...(platformInfo.os && !platformInfo.error ? { '__platform_os': platformInfo.os } : {})
        },
        isComposeManaged: Boolean(composeProject && composeService),
        composeProject,
        composeService,
        composeWorkingDir,
        composeFolderName,
        composeGroupKey,
        composeConfigFiles: (labels as any)['com.docker.compose.project.config_files'] ? String((labels as any)['com.docker.compose.project.config_files']).split(',') : null,
        runCommand: !composeProject ? await this.generateRunCommand(det, b.name) : undefined
      };

      if (existing) {
        await this.prisma.container.update({ where: { id: existing.id }, data: { containerId: fullId, ...commonData } as any });
        await this.prisma.container.deleteMany({ where: { hostId: host.id, containerId: { in: [b.id, shortId] }, NOT: { id: existing.id } } });
      } else {
        await this.prisma.container.upsert({
          where: { hostId_containerId: { hostId: host.id, containerId: fullId } },
          update: commonData as any,
          create: ({ hostId: host.id, containerId: fullId, ...commonData } as any)
        });
      }
      upserted++;
    }
    // 对于 CLI 容器：若在 docker ps -a 中未出现，则标记为 stopped
    try {
      const missingCli = await this.prisma.container.findMany({
        where: { hostId: host.id, isComposeManaged: false, containerId: { notIn: Array.from(seenIds) } },
        select: { id: true }
      });
      if (missingCli.length) {
        await this.prisma.container.updateMany({
          where: { id: { in: missingCli.map(m => m.id) } },
          data: { state: 'stopped', status: 'stopped', startedAt: null as any }
        });
      }
    } catch {}
    return upserted;
  }

  async discover(bodyHost?: { id?: string; address?: string; sshUser?: string; port?: number } | { id: 'all' }, opId?: string): Promise<{ upserted: number }> {
    // 支持：传入完整主机、hostId 或 'all'；若 bodyHost 缺失则视为 all
    if (bodyHost && (bodyHost as any).address && (bodyHost as any).sshUser && (bodyHost as any).id) {
      const n = await this.discoverOnHost(bodyHost as any, opId);
      const r = { upserted: n };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }
    const hostId = bodyHost ? ((bodyHost as any).id as string | undefined) : undefined;
    if (!hostId || hostId === 'all') {
      const hosts = await this.prisma.host.findMany({ select: { id: true, address: true, sshUser: true, port: true }, take: 1000 });
      let total = 0;
      for (const h of hosts) total += await this.discoverOnHost({ id: h.id, address: h.address, sshUser: h.sshUser, port: h.port ?? undefined }, opId);
      // 自动触发一次重复清理（保护性）
      try { await this.cleanupDuplicates('all', opId); } catch {}
      const r = { upserted: total };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    } else {
      const h = await this.prisma.host.findUnique({ where: { id: hostId }, select: { id: true, address: true, sshUser: true, port: true } });
      if (!h) {
        const r = { upserted: 0 };
        if (opId) this.gateway.broadcast(opId, 'end', r);
        return r;
      }
      const n = await this.discoverOnHost({ id: h.id, address: h.address, sshUser: h.sshUser, port: h.port ?? undefined }, opId);
      try { await this.cleanupDuplicates(h.id, opId); } catch {}
      const r = { upserted: n };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }
  }

  async checkUpdates(host: { id: string; address: string; sshUser: string; port?: number }, opId?: string): Promise<{ updated: number }> {
    // 获取主机凭据以进行远程检查
    const hostCred = await this.getHostCredById(host.id);
    if (!hostCred) {
      this.logger.error(`无法获取主机凭据: ${host.id}`);
      return { updated: 0 };
    }

    const containers = await this.prisma.container.findMany({ where: { hostId: host.id, imageName: { not: null } }, take: 200 });
    let marked = 0;
    let failed = 0;

    for (const c of containers) {
      const imageRef = c.imageTag ? `${c.imageName}:${c.imageTag}` : c.imageName || '';
      if (!imageRef) continue;

      try {
        // 从容器的labels中提取平台信息
        const labels = (c.labels as any) || {};
        const platform = {
          architecture: labels['__platform_arch'] || 'amd64',
          os: labels['__platform_os'] || 'linux'
        };

        // 使用新的方法检查镜像更新，不会实际拉取镜像，并考虑平台匹配
        if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] 检查镜像 ${imageRef} 的远程版本 (${platform.architecture}/${platform.os})...`);
        
        const updateResult = await this.docker.checkImageUpdate(hostCred, imageRef, c.repoDigest, platform);
        
        if (updateResult.error) {
          // 如果无法获取远程信息，记录警告但继续处理其他容器
          this.logger.warn(`检查镜像 ${imageRef} 更新失败: ${updateResult.error}`);
          
          // 检查是否是速率限制错误
          if ((updateResult as any).rateLimited) {
            if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] ⚠️ ${imageRef}: Docker Hub 速率限制，已尝试镜像加速器但仍失败`);
            this.logger.warn(`镜像 ${imageRef} 遇到 Docker Hub 速率限制`);
          } else {
            if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] ❌ 跳过 ${imageRef}: ${updateResult.error}`);
          }
          
          failed++;
          
          // 更新检查时间，但不更新 updateAvailable 状态
          await this.prisma.container.update({ 
            where: { id: c.id }, 
            data: { updateCheckedAt: new Date() } 
          });
          continue;
        }

        const { updateAvailable, remoteDigest } = updateResult;
        
        if (opId) {
          if (updateAvailable) {
            this.gateway.broadcast(opId, 'data', `[${host.address}] ✓ ${imageRef} 有更新可用 (${platform.architecture}/${platform.os})`);
          } else {
            this.gateway.broadcast(opId, 'data', `[${host.address}] ✓ ${imageRef} 已是最新版本 (${platform.architecture}/${platform.os})`);
          }
        }

        // 更新数据库中的状态
        await this.prisma.container.update({ 
          where: { id: c.id }, 
          data: { 
            remoteDigest: remoteDigest || null, 
            updateAvailable, 
            updateCheckedAt: new Date() 
          } 
        });

        if (updateAvailable) marked++;

      } catch (error) {
        this.logger.error(`检查容器 ${c.name} (${imageRef}) 更新时发生错误: ${error instanceof Error ? error.message : String(error)}`);
        if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] ❌ ${imageRef} 检查失败: ${error instanceof Error ? error.message : '未知错误'}`);
        failed++;
        
        // 即使失败也更新检查时间
        try {
          await this.prisma.container.update({ 
            where: { id: c.id }, 
            data: { updateCheckedAt: new Date() } 
          });
        } catch {}
      }
    }

    const summary = `检查完成: ${marked} 个可更新, ${failed} 个失败, ${containers.length - marked - failed} 个最新`;
    if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] ${summary}`);
    this.logger.log(`[${host.address}] ${summary}`);

    return { updated: marked };
  }

  async checkSingleContainerUpdate(containerId: string, opId?: string): Promise<{ updated: number; containerName?: string; error?: string }> {
    try {
      // 获取容器信息
      const container = await this.prisma.container.findUnique({ where: { id: containerId } });
      if (!container) {
        return { updated: 0, error: '容器不存在' };
      }

      // 获取主机凭据
      const hostCred = await this.getHostCredById(container.hostId);
      if (!hostCred) {
        return { updated: 0, error: '无法获取主机凭据' };
      }

      if (opId) {
        this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 开始检查容器 ${container.name} 的更新...`);
      }

      // 第一件事：inspect 现有容器，更新数据库中的信息
      if (opId) {
        this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在获取容器 ${container.name} 的最新状态...`);
      }

      try {
        // 获取容器的最新状态信息
        const containerDetails = await this.docker.inspectContainers(hostCred, [container.containerId]);
        if (containerDetails && containerDetails.length > 0) {
          const containerInfo = containerDetails[0];
          
          // 提取容器信息
          const state = containerInfo.State?.Status || container.state;
          const status = containerInfo.State?.Status || container.status;
          const restartCount = containerInfo.RestartCount || container.restartCount;
          const startedAt = containerInfo.State?.StartedAt ? new Date(containerInfo.State.StartedAt) : container.startedAt;
          
          // 提取端口信息
          const ports = containerInfo.NetworkSettings?.Ports || container.ports;
          
          // 提取挂载信息
          const mounts = containerInfo.Mounts || container.mounts;
          
          // 提取网络信息
          const networks = containerInfo.NetworkSettings?.Networks || container.networks;
          
          // 提取标签信息
          const labels = containerInfo.Config?.Labels || container.labels;
          
          // 提取镜像 digest
          const repoDigest = containerInfo.Image || container.repoDigest;
          
          // 更新数据库中的容器信息
          await this.prisma.container.update({
            where: { id: container.id },
            data: {
              state,
              status,
              restartCount,
              startedAt,
              ports,
              mounts,
              networks,
              labels,
              repoDigest,
            }
          });

          if (opId) {
            this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ✓ 容器状态已更新`);
          }
        }
      } catch (inspectError) {
        this.logger.warn(`获取容器 ${container.name} 状态信息失败: ${inspectError instanceof Error ? inspectError.message : String(inspectError)}`);
        if (opId) {
          this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ⚠️ 获取容器状态失败，继续检查更新...`);
        }
      }

      const imageRef = container.imageTag ? `${container.imageName}:${container.imageTag}` : container.imageName || '';
      if (!imageRef) {
        return { updated: 0, error: '容器缺少镜像信息' };
      }

      if (opId) {
        this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 检查镜像 ${imageRef} 的远程版本...`);
      }

      try {
        // 从容器的labels中提取平台信息
        const labels = (container.labels as any) || {};
        const platform = {
          architecture: labels['__platform_arch'] || 'amd64',
          os: labels['__platform_os'] || 'linux'
        };

        // 检查镜像更新
        if (opId) {
          this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 检查镜像 ${imageRef} 的远程版本 (${platform.architecture}/${platform.os})...`);
        }
        
        const updateResult = await this.docker.checkImageUpdate(hostCred, imageRef, container.repoDigest, platform);
        
        if (updateResult.error) {
          this.logger.warn(`检查容器 ${container.name} 镜像 ${imageRef} 更新失败: ${updateResult.error}`);
          
          // 检查是否是速率限制错误
          if ((updateResult as any).rateLimited) {
            if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ⚠️ ${imageRef}: Docker Hub 速率限制，已尝试镜像加速器但仍失败`);
          } else {
            if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ❌ ${container.name}: ${updateResult.error}`);
          }
          
          // 更新检查时间，但不更新 updateAvailable 状态
          await this.prisma.container.update({ 
            where: { id: container.id }, 
            data: { updateCheckedAt: new Date() } 
          });
          
          return { updated: 0, containerName: container.name, error: updateResult.error };
        }

        const { updateAvailable, remoteDigest } = updateResult;
        
        if (opId) {
          if (updateAvailable) {
            this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ✓ ${container.name} (${imageRef}) 有更新可用 (${platform.architecture}/${platform.os})`);
          } else {
            this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ✓ ${container.name} (${imageRef}) 已是最新版本 (${platform.architecture}/${platform.os})`);
          }
        }

        // 更新数据库中的状态
        await this.prisma.container.update({ 
          where: { id: container.id }, 
          data: { 
            remoteDigest: remoteDigest || null, 
            updateAvailable, 
            updateCheckedAt: new Date() 
          } 
        });

        const result = { updated: updateAvailable ? 1 : 0, containerName: container.name };
        if (opId) this.gateway.broadcast(opId, 'end', result);
        
        return result;
      } catch (error) {
        this.logger.error(`检查容器 ${container.name} (${imageRef}) 更新时发生错误: ${error instanceof Error ? error.message : String(error)}`);
        if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ❌ ${imageRef} 检查失败: ${error instanceof Error ? error.message : '未知错误'}`);
        
        // 即使失败也更新检查时间
        try {
          await this.prisma.container.update({ 
            where: { id: container.id }, 
            data: { updateCheckedAt: new Date() } 
          });
        } catch {}
        
        return { updated: 0, containerName: container.name, error: error instanceof Error ? error.message : String(error) };
      }
    } catch (error) {
      this.logger.error(`检查单个容器更新失败: ${error instanceof Error ? error.message : String(error)}`);
      return { updated: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async checkUpdatesAny(bodyHost: { id?: string; address?: string; sshUser?: string; port?: number } | { id: 'all' }, opId?: string): Promise<{ updated: number }> {
    if ((bodyHost as any).address && (bodyHost as any).sshUser && (bodyHost as any).id) {
      const r = await this.checkUpdates(bodyHost as any, opId);
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }
    const hostId = (bodyHost as any).id as string | undefined;
    if (!hostId || hostId === 'all') {
      const hosts = await this.prisma.host.findMany({ select: { id: true, address: true, sshUser: true, port: true }, take: 1000 });
      let total = 0;
      for (const h of hosts) {
        const res = await this.checkUpdates({ id: h.id, address: h.address, sshUser: h.sshUser, port: h.port ?? undefined }, opId);
        total += res.updated;
      }
      const r = { updated: total };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    } else {
      const h = await this.prisma.host.findUnique({ where: { id: hostId }, select: { id: true, address: true, sshUser: true, port: true } });
      if (!h) {
        const r = { updated: 0 };
        if (opId) this.gateway.broadcast(opId, 'end', r);
        return r;
      }
      const r = await this.checkUpdates({ id: h.id, address: h.address, sshUser: h.sshUser, port: h.port ?? undefined }, opId);
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }
  }

  async updateOne(hostOrRef: { id: string; address: string; sshUser: string; port?: number } | { id: string }, containerId: string, imageRef?: string, opId?: string) {
    const c = await this.prisma.container.findUnique({ where: { id: containerId } });
    if (!c) return { ok: false, reason: 'not found' };
    
    this.logs.addLog('info', `更新容器: ${c.name} (${c.containerId.slice(0, 12)}) -> ${imageRef || c.imageName}`, 'containers');
    const ref = imageRef || (c.imageTag ? `${c.imageName}:${c.imageTag}` : c.imageName);
    if (!ref) return { ok: false, reason: 'no image' };

    // 使用解密后的主机凭据（用于 execShell / docker compose）
    const hostCred = await this.getHostCredById(c.hostId);
    if (!hostCred) return { ok: false, reason: 'no host' };

    // 如果该容器由 Compose 管理，则走 Compose 分支，避免 CLI 停/删/重建
    if (c.isComposeManaged && c.composeWorkingDir && c.composeService) {
      // 先拉取镜像，再对目标服务 up --no-deps
      const pullCmd = `cd ${c.composeWorkingDir} && docker compose pull ${c.composeService}`;
      const pullRes = await this.docker.execShell(hostCred as any, pullCmd, 600);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${pullRes.cmd}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 退出码: ${pullRes.code}`);

      const upCmd = `cd ${c.composeWorkingDir} && docker compose up -d --no-deps ${c.composeService}`;
      const upRes = await this.docker.execShell(hostCred as any, upCmd, 600);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${upRes.cmd}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 退出码: ${upRes.code}`);

      await this.prisma.container.update({ where: { id: c.id }, data: { updateAvailable: false } });
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在刷新 Compose 组状态...`);
      try { await this.refreshStatus(hostCred.id, { composeProject: c.composeProject || undefined }, opId); } catch {}
      const r = { ok: upRes.code === 0 } as const;
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }

    // CLI 容器分支：先备份，后更新，失败时回滚
    if (!c.runCommand) {
      const error = 'CLI容器缺少runCommand，无法更新。请重新发现容器以生成启动命令。';
      this.logger.error(error);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 错误: ${error}`);
      const r = { ok: false, reason: 'missing runCommand' };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }

    // 1. 拉取新镜像
    const pullRes = await this.docker.exec(hostCred as any, ['pull', ref], 300);
    if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${pullRes.cmd}\n退出码: ${pullRes.code}`);
    if (pullRes.code !== 0) {
      const error = '拉取新镜像失败';
      this.logger.error(`${error}: ${pullRes.stderr}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 错误: ${error}`);
      const r = { ok: false, reason: 'pull failed' };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }

    // 2. 备份旧容器（重命名）
    const backupName = `${c.name}_backup_${Date.now()}`;
    const renameRes = await this.docker.exec(hostCred as any, ['rename', c.containerId, backupName], 60);
    if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${renameRes.cmd}\n退出码: ${renameRes.code}`);
    if (renameRes.code !== 0) {
      const error = '备份旧容器失败';
      this.logger.error(`${error}: ${renameRes.stderr}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 错误: ${error}`);
      const r = { ok: false, reason: 'backup failed' };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }

    // 3. 使用保存的runCommand重新创建容器
    try {
      const recreateRes = await this.docker.execShell(hostCred as any, c.runCommand, 300);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${recreateRes.cmd}\n退出码: ${recreateRes.code}`);
      
      if (recreateRes.code !== 0) {
        // 重新创建失败，回滚：删除失败的容器（如果存在），恢复备份
        this.logger.error(`重新创建容器失败，开始回滚: ${recreateRes.stderr}`);
        if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 重新创建失败，开始回滚...`);
        
        // 尝试删除可能创建失败的容器
        try {
          await this.docker.exec(hostCred as any, ['rm', '-f', c.name], 60);
        } catch {}
        
        // 恢复备份容器
        const restoreRes = await this.docker.exec(hostCred as any, ['rename', backupName, c.name], 60);
        if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 回滚: ${restoreRes.cmd}\n退出码: ${restoreRes.code}`);
        
        const error = '重新创建容器失败，已回滚到原始状态';
        if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${error}`);
        const r = { ok: false, reason: 'recreate failed, rolled back' };
        if (opId) this.gateway.broadcast(opId, 'end', r);
        return r;
      }

      // 4. 重新创建成功，删除备份容器
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 容器重新创建成功，清理备份...`);
      const cleanupRes = await this.docker.exec(hostCred as any, ['rm', '-f', backupName], 60);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${cleanupRes.cmd}\n退出码: ${cleanupRes.code}`);

      // 5. 更新数据库状态
      await this.prisma.container.update({ where: { id: c.id }, data: { updateAvailable: false } });

      // 6. 刷新容器状态
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在刷新容器状态...`);
      try { await this.refreshStatus(hostCred.id, { containerNames: [c.name] }, opId); } catch {}
      
      const r = { ok: true };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;

    } catch (error) {
      // 发生异常，尝试回滚
      this.logger.error(`CLI容器更新过程中发生异常，开始回滚: ${error instanceof Error ? error.message : String(error)}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 异常，开始回滚: ${error instanceof Error ? error.message : String(error)}`);
      
      try {
        // 尝试删除可能创建失败的容器
        await this.docker.exec(hostCred as any, ['rm', '-f', c.name], 60);
        // 恢复备份容器
        const restoreRes = await this.docker.exec(hostCred as any, ['rename', backupName, c.name], 60);
        if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 回滚: ${restoreRes.cmd}\n退出码: ${restoreRes.code}`);
      } catch (rollbackError) {
        this.logger.error(`回滚失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 回滚失败: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }

      const r = { ok: false, reason: 'exception occurred, rolled back' };
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }
  }

  async restartOne(hostOrRef: { id: string; address: string; sshUser: string; port?: number } | { id: string }, containerId: string, opId?: string) {
    const c = await this.prisma.container.findUnique({ where: { id: containerId } });
    if (!c) return { ok: false, reason: 'not found' };
    
    this.logs.addLog('info', `重启容器: ${c.name} (${c.containerId.slice(0, 12)})`, 'containers');
    const host = 'address' in hostOrRef ? hostOrRef as any : await this.prisma.host.findUnique({ where: { id: (hostOrRef as any).id } }) as any;
    if (!host) return { ok: false, reason: 'no host' };
    const restartRes = await this.docker.exec(host, ['restart', c.containerId], 120);
    this.logs.addLog('info', `[${host.address}] ${restartRes.cmd}`, 'containers');
    this.logs.addLog('info', `[${host.address}] 退出码: ${restartRes.code}`, 'containers');
    if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] ${restartRes.cmd}\n退出码: ${restartRes.code}`);
    // 仅刷新本容器状态
    if (opId) this.gateway.broadcast(opId, 'data', `[${host.address}] 正在刷新容器状态...`);
    try { await this.refreshStatus(host.id, { containerIds: [c.id] }, opId); } catch {}
    const r = { ok: true };
    if (opId) this.gateway.broadcast(opId, 'end', r);
    return r;
  }

  async startOne(hostOrRef: { id: string; address: string; sshUser: string; port?: number } | { id: string }, containerId: string, opId?: string) {
    const c = await this.prisma.container.findUnique({ where: { id: containerId } });
    if (!c) return { ok: false, reason: 'not found' };
    
    await this.logs.addLog('info', `启动容器: ${c.name} (${c.containerId.slice(0, 12)})`, 'container', { 
      source: 'containers',
      hostId: c.hostId,
      metadata: { containerId: c.containerId, containerName: c.name, operation: 'start' }
    });
    const hostCred = await this.getHostCredById(c.hostId);
    if (!hostCred) return { ok: false, reason: 'no host' };

    if (c.isComposeManaged && c.composeWorkingDir && c.composeService) {
      const cmd = `cd ${c.composeWorkingDir} && docker compose start ${c.composeService}`;
      const res = await this.docker.execShell(hostCred as any, cmd, 300);
      this.logs.addLog('info', `[${hostCred.address}] ${res.cmd}`, 'containers');
      this.logs.addLog('info', `[${hostCred.address}] 退出码: ${res.code}`, 'containers');
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${res.cmd}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 退出码: ${res.code}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在刷新 Compose 组状态...`);
      this.logs.addLog('info', `[${hostCred.address}] 正在刷新 Compose 组状态...`, 'containers');
      try { await this.refreshStatus(hostCred.id, { composeProject: c.composeProject || undefined }, opId); } catch {}
      const r = { ok: res.code === 0 } as const;
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }

    const res = await this.docker.exec(hostCred as any, ['start', c.containerId], 120);
    this.logs.addLog('info', `[${hostCred.address}] ${res.cmd}`, 'containers');
    this.logs.addLog('info', `[${hostCred.address}] 退出码: ${res.code}`, 'containers');
    if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${res.cmd}\n退出码: ${res.code}`);
    if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在刷新容器状态...`);
    this.logs.addLog('info', `[${hostCred.address}] 正在刷新容器状态...`, 'containers');
    try { await this.refreshStatus(hostCred.id, { containerIds: [c.id] }, opId); } catch {}
    const r = { ok: res.code === 0 } as const;
    if (opId) this.gateway.broadcast(opId, 'end', r);
    return r;
  }

  async stopOne(hostOrRef: { id: string; address: string; sshUser: string; port?: number } | { id: string }, containerId: string, opId?: string) {
    const c = await this.prisma.container.findUnique({ where: { id: containerId } });
    if (!c) return { ok: false, reason: 'not found' };
    
    this.logs.addLog('info', `停止容器: ${c.name} (${c.containerId.slice(0, 12)})`, 'containers');
    const hostCred = await this.getHostCredById(c.hostId);
    if (!hostCred) return { ok: false, reason: 'no host' };

    if (c.isComposeManaged && c.composeWorkingDir && c.composeService) {
      const cmd = `cd ${c.composeWorkingDir} && docker compose stop ${c.composeService}`;
      const res = await this.docker.execShell(hostCred as any, cmd, 300);
      this.logs.addLog('info', `[${hostCred.address}] ${res.cmd}`, 'containers');
      this.logs.addLog('info', `[${hostCred.address}] 退出码: ${res.code}`, 'containers');
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${res.cmd}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 退出码: ${res.code}`);
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在刷新 Compose 组状态...`);
      this.logs.addLog('info', `[${hostCred.address}] 正在刷新 Compose 组状态...`, 'containers');
      try { await this.refreshStatus(hostCred.id, { composeProject: c.composeProject || undefined }, opId); } catch {}
      const r = { ok: res.code === 0 } as const;
      if (opId) this.gateway.broadcast(opId, 'end', r);
      return r;
    }

    const res = await this.docker.exec(hostCred as any, ['stop', c.containerId], 120);
    this.logs.addLog('info', `[${hostCred.address}] ${res.cmd}`, 'containers');
    this.logs.addLog('info', `[${hostCred.address}] 退出码: ${res.code}`, 'containers');
    if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${res.cmd}\n退出码: ${res.code}`);
    if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在刷新容器状态...`);
    this.logs.addLog('info', `[${hostCred.address}] 正在刷新容器状态...`, 'containers');
    try { await this.refreshStatus(hostCred.id, { containerIds: [c.id] }, opId); } catch {}
    const r = { ok: res.code === 0 } as const;
    if (opId) this.gateway.broadcast(opId, 'end', r);
    return r;
  }

  private async getHostCredById(hostId: string): Promise<{ id: string; address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string } | null> {
    const h = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!h) return null;
    const decPassword = this.crypto?.decryptString((h as any)?.sshPassword ?? null) ?? undefined;
    const decKey = this.crypto?.decryptString((h as any)?.sshPrivateKey ?? null) ?? undefined;
    const decPassphrase = this.crypto?.decryptString((h as any)?.sshPrivateKeyPassphrase ?? null) ?? undefined;
    return { id: h.id, address: h.address, sshUser: h.sshUser, port: h.port ?? undefined, password: decPassword, privateKey: decKey, privateKeyPassphrase: decPassphrase };
  }

  // 生成 CLI 容器的 docker run 命令（基于 docker inspect 信息重建）
  private async generateRunCommand(inspectData: any, containerName: string): Promise<string | undefined> {
    try {
      if (!inspectData || !inspectData.Config) return undefined;
      
      const config = inspectData.Config || {};
      const hostConfig = inspectData.HostConfig || {};
      const networkSettings = inspectData.NetworkSettings || {};
      
      const parts: string[] = ['docker', 'run', '-d'];
      
      // 容器名称
      if (containerName) {
        parts.push('--name', containerName);
      }
      
      // 重启策略
      if (hostConfig.RestartPolicy?.Name) {
        const restartPolicy = hostConfig.RestartPolicy.Name;
        if (restartPolicy === 'on-failure' && hostConfig.RestartPolicy.MaximumRetryCount) {
          parts.push('--restart', `${restartPolicy}:${hostConfig.RestartPolicy.MaximumRetryCount}`);
        } else if (restartPolicy !== 'no') {
          parts.push('--restart', restartPolicy);
        }
      }
      
      // 端口映射
      if (hostConfig.PortBindings) {
        for (const [containerPort, bindings] of Object.entries(hostConfig.PortBindings)) {
          if (Array.isArray(bindings) && bindings.length > 0) {
            const binding = bindings[0] as any;
            const hostPort = binding.HostPort;
            const hostIp = binding.HostIp;
            if (hostPort) {
              const portMap = hostIp && hostIp !== '0.0.0.0' ? `${hostIp}:${hostPort}:${containerPort}` : `${hostPort}:${containerPort}`;
              parts.push('-p', portMap);
            }
          }
        }
      }
      
      // 卷挂载
      if (inspectData.Mounts && Array.isArray(inspectData.Mounts)) {
        for (const mount of inspectData.Mounts) {
          if (mount.Type === 'bind') {
            parts.push('-v', `${mount.Source}:${mount.Destination}${mount.RW === false ? ':ro' : ''}`);
          } else if (mount.Type === 'volume') {
            parts.push('-v', `${mount.Name}:${mount.Destination}${mount.RW === false ? ':ro' : ''}`);
          }
        }
      }
      
      // 环境变量
      if (config.Env && Array.isArray(config.Env)) {
        for (const env of config.Env) {
          // 跳过系统默认的环境变量
          if (!env.startsWith('PATH=') && !env.startsWith('HOSTNAME=')) {
            parts.push('-e', env);
          }
        }
      }
      
      // 网络模式
      if (hostConfig.NetworkMode && hostConfig.NetworkMode !== 'default' && hostConfig.NetworkMode !== 'bridge') {
        parts.push('--network', hostConfig.NetworkMode);
      }
      
      // 工作目录
      if (config.WorkingDir) {
        parts.push('-w', config.WorkingDir);
      }
      
      // 用户
      if (config.User) {
        parts.push('-u', config.User);
      }
      
      // 标签
      if (config.Labels) {
        for (const [key, value] of Object.entries(config.Labels)) {
          if (typeof value === 'string' && !key.startsWith('com.docker.compose.')) {
            parts.push('--label', `${key}=${value}`);
          }
        }
      }
      
      // 镜像
      const image = config.Image || '';
      if (image) {
        parts.push(image);
      }
      
      // 启动命令和参数
      if (config.Cmd && Array.isArray(config.Cmd) && config.Cmd.length > 0) {
        parts.push(...config.Cmd);
      }
      
      return parts.join(' ');
    } catch (error) {
      this.logger.warn(`生成 runCommand 失败: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  // 仅刷新指定容器（或 compose 项目）状态，避免全量扫描
  async refreshStatus(hostId: string, options: { containerIds?: string[]; containerNames?: string[]; composeProject?: string }, opId?: string): Promise<{ updated: number; notFound: string[] }> {
    const hostCred = await this.getHostCredById(hostId);
    if (!hostCred) return { updated: 0, notFound: [] };

    let targets: { id: string; name: string }[] = [];
    if (options.composeProject) {
      // 先用 compose ls 判断项目整体状态
      try {
        const ls = await this.docker.composeLs(hostCred);
        const found = ls.find((x: any) => x?.Name === options.composeProject);
        if (found && typeof found.Status === 'string') {
          const statusLower = String(found.Status).toLowerCase();
          // 如果项目整体状态非 running，则先把该项目下所有 DB 记录标记为 stopped
          if (!statusLower.includes('running') && !statusLower.includes('up')) {
            await this.prisma.container.updateMany({ where: { hostId, isComposeManaged: true, composeProject: options.composeProject }, data: { state: 'stopped', status: 'stopped', startedAt: null as any } });
          }
        } else {
          // compose ls 无此项目，视为项目已停止/下线，标记为 stopped
          await this.prisma.container.updateMany({ where: { hostId, isComposeManaged: true, composeProject: options.composeProject }, data: { state: 'stopped', status: 'stopped', startedAt: null as any } });
        }
      } catch {}

      // 优先通过 docker ps 读取该项目现存容器（包含已重建的新ID）
      const ps = await this.docker.psByComposeProject(hostCred, options.composeProject);
      for (const j of ps) {
        const id = j.ID || j.Id || '';
        const name = j.Names || j.NamesFormatted || j.NamesValue || j.NamesDisplay || j.NamesLabel || j.Names || 'unknown';
        if (id) targets.push({ id, name });
      }
      // 同时补充 DB 已知的容器（可能已停止或被删除）
      const rows = await this.prisma.container.findMany({ where: { hostId, isComposeManaged: true, composeProject: options.composeProject }, select: { id: true, containerId: true, name: true } });
      for (const r of rows) targets.push({ id: r.containerId, name: r.name });
    }
    if (options.containerIds?.length) {
      const rows = await this.prisma.container.findMany({ where: { id: { in: options.containerIds } }, select: { id: true, containerId: true, name: true, hostId: true } });
      targets.push(...rows.filter(r => r.hostId === hostId).map(r => ({ id: r.containerId, name: r.name })));
    }
    if (options.containerNames?.length) {
      const rows = await this.prisma.container.findMany({ where: { hostId, name: { in: options.containerNames } }, select: { id: true, containerId: true, name: true } });
      targets.push(...rows.map(r => ({ id: r.containerId, name: r.name })));
    }
    // 去重
    const uniqIds = Array.from(new Set(targets.map(t => t.id)));
    if (!uniqIds.length) return { updated: 0, notFound: [] };

    const details = await this.docker.inspectContainers(hostCred, uniqIds);
    const byId = new Map<string, any>();
    const byShortId = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const d of details) {
      if (!d) continue;
      const id = d.Id as string;
      const shortId = (id || '').slice(0, 12);
      const name = typeof d.Name === 'string' ? String(d.Name).replace(/^\//, '') : '';
      if (id) byId.set(id, d);
      if (shortId) byShortId.set(shortId, d);
      if (name) byName.set(name, d);
    }
    let updated = 0;
    const notFound: string[] = [];
    for (const t of targets) {
      const det = byId.get(t.id) || byShortId.get(t.id) || byName.get(t.name);
      if (!det) { notFound.push(t.id); continue; }
      const state = det.State || {};
      // 规范化状态：优先用 State.Status；无则根据 Running/Paused/Dead/Epoch 判断
      let statusStr: string | undefined = state.Status || undefined;
      if (!statusStr) {
        const running = Boolean(state.Running);
        const paused = Boolean(state.Paused);
        const dead = Boolean(state.Dead);
        statusStr = running ? 'running' : paused ? 'paused' : dead ? 'dead' : 'stopped';
      }
      const startedAt = state.StartedAt ? new Date(state.StartedAt) : null;
      const restartCount = typeof state.Restarting === 'number' ? state.Restarting : undefined;
      await this.prisma.container.updateMany({ where: { hostId, OR: [ { containerId: t.id }, { name: t.name } ] }, data: {
        state: statusStr,
        status: statusStr,
        startedAt: startedAt ?? undefined,
        restartCount: restartCount ?? undefined,
      }});
      updated++;
    }
    // 未找到的容器视为 stopped（compose down 后短期内无法 inspect）
    if (notFound.length) {
      await this.prisma.container.updateMany({
        where: { hostId, containerId: { in: notFound } },
        data: { state: 'stopped', status: 'stopped', startedAt: null as any }
      });
    }
    if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 局部刷新完成：更新 ${updated}，未找到并标记为 stopped：${notFound.length}`);
    return { updated, notFound };
  }

  // 周期性刷新正在运行中的容器状态，矫正 UI 偶发不一致
  async refreshRunningStatusAllHosts(): Promise<number> {
    const running = await this.prisma.container.findMany({ where: { OR: [ { state: { in: ['running', 'restarting', 'starting'] } }, { status: { contains: 'Up' } } ] }, select: { id: true, hostId: true, containerId: true } });
    const byHost = new Map<string, string[]>();
    for (const r of running) {
      const arr = byHost.get(r.hostId) || [];
      arr.push(r.id);
      byHost.set(r.hostId, arr);
    }
    let total = 0;
    for (const [hostId, ids] of byHost) {
      const res = await this.refreshStatus(hostId, { containerIds: ids });
      total += res.updated;
    }
    return total;
  }

  // 组级 Compose 操作：在 composeWorkingDir 中执行 docker compose *
  async composeOperate(hostId: string, project: string, workingDir: string, op: 'down'|'pull'|'up'|'restart'|'start'|'stop', opId?: string): Promise<{ ok: boolean; code: number }> {
    const h = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!h) return { ok: false, code: 1 };
    
    await this.logs.addLog('info', `Compose 操作: ${op} (项目: ${project})`, 'container', { 
      source: 'containers',
      hostId: hostId,
      metadata: { operation: `compose_${op}`, project, workingDir }
    });
    const cmd = (() => {
      switch (op) {
        case 'down': return `cd ${workingDir} && docker compose down`;
        case 'pull': return `cd ${workingDir} && docker compose pull`;
        case 'up': return `cd ${workingDir} && docker compose up -d`;
        case 'restart': return `cd ${workingDir} && docker compose restart`;
        case 'start': return `cd ${workingDir} && docker compose start`;
        case 'stop': return `cd ${workingDir} && docker compose stop`;
      }
    })();
    // 附带解密后的凭据，避免 SSH 255
    const decPassword = this.crypto?.decryptString((h as any)?.sshPassword ?? null) ?? undefined;
    const decKey = this.crypto?.decryptString((h as any)?.sshPrivateKey ?? null) ?? undefined;
    const decPassphrase = this.crypto?.decryptString((h as any)?.sshPrivateKeyPassphrase ?? null) ?? undefined;
    const res = await this.docker.execShell({ id: h.id, address: h.address, sshUser: h.sshUser, port: h.port, password: decPassword, privateKey: decKey, privateKeyPassphrase: decPassphrase } as any, cmd, 600);
    await this.logs.addLog('info', `[${h.address}] ${res.cmd}`, 'container', { 
      source: 'containers',
      hostId: h.id,
      hostLabel: h.address,
      metadata: { operation: `compose_${op}`, project, command: res.cmd }
    });
    await this.logs.addLog('info', `[${h.address}] 退出码: ${res.code}`, 'container', { 
      source: 'containers',
      hostId: h.id,
      hostLabel: h.address,
      metadata: { operation: `compose_${op}`, project, exitCode: res.code }
    });
    if (opId) {
      this.gateway.broadcast(opId, 'data', `[${h.address}] ${res.cmd}`);
      this.gateway.broadcast(opId, 'data', `[${h.address}] 退出码: ${res.code}`);
      this.gateway.broadcast(opId, 'data', `[${h.address}] 正在刷新 Compose 组状态...`);
    }
    await this.logs.addLog('info', `[${h.address}] 正在刷新 Compose 组状态...`, 'container', { 
      source: 'containers',
      hostId: h.id,
      hostLabel: h.address,
      metadata: { operation: `compose_${op}`, project }
    });
    try { 
      const refreshResult = await this.refreshStatus(h.id, { composeProject: project }, opId);
      await this.logs.addLog('info', `[${h.address}] 局部刷新完成：更新 ${refreshResult?.updated || 0}，未找到并标记为 stopped：${refreshResult?.notFound?.length || 0}`, 'container', { 
        source: 'containers',
        hostId: h.id,
        hostLabel: h.address,
        metadata: { operation: `compose_${op}`, project, refreshResult }
      });
    } catch {}
    const result = { ok: res.code === 0, code: res.code };
    if (opId) this.gateway.broadcast(opId, 'end', result);
    return result;
  }

  async cleanupDuplicates(hostId?: string | 'all', opId?: string): Promise<number> {
    const hosts = hostId && hostId !== 'all'
      ? await this.prisma.host.findMany({ where: { id: hostId }, select: { id: true } })
      : await this.prisma.host.findMany({ select: { id: true } });
    let removed = 0;
    for (const h of hosts) {
      const list = await this.prisma.container.findMany({
        where: { hostId: h.id },
        select: { id: true, containerId: true, name: true, createdAt: true, startedAt: true }
      });

      // 1) 按 containerId 清理：同一 host 下相同 ID 仅保留创建时间最新的一条
      const byId = new Map<string, { id: string; createdAt: Date }[]>();
      for (const c of list) {
        const arr = byId.get(c.containerId) || [];
        arr.push({ id: c.id, createdAt: c.createdAt });
        byId.set(c.containerId, arr);
      }
      const deleteIds1: string[] = [];
      for (const [cid, arr] of byId) {
        if (arr.length <= 1) continue;
        arr.sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
        const keep = arr[0].id;
        for (let i = 1; i < arr.length; i++) deleteIds1.push(arr[i].id);
        if (opId && arr.length > 1) this.gateway.broadcast(opId, 'data', `[${h.id}] 同一ID(${cid}) 保留最新 ${keep}，删除 ${arr.length - 1} 条`);
      }
      if (deleteIds1.length) {
        await this.prisma.container.deleteMany({ where: { id: { in: deleteIds1 } } });
        removed += deleteIds1.length;
      }

      // 2) 按名称清理：同一 host 下同名容器仅保留"启动时间/创建时间最新"的一条
      const remaining = await this.prisma.container.findMany({
        where: { hostId: h.id },
        select: { id: true, name: true, createdAt: true, startedAt: true }
      });
      const byName = new Map<string, { id: string; createdAt: Date; startedAt: Date | null }[]>();
      for (const c of remaining) {
        const arr = byName.get(c.name) || [];
        arr.push({ id: c.id, createdAt: c.createdAt, startedAt: (c.startedAt as any) || null });
        byName.set(c.name, arr);
      }
      const score = (x: { createdAt: Date; startedAt: Date | null }) => (x.startedAt?.getTime?.() || 0) || (x.createdAt?.getTime?.() || 0);
      const deleteIds2: string[] = [];
      for (const [name, arr] of byName) {
        if (arr.length <= 1) continue;
        arr.sort((a, b) => score(b) - score(a));
        const keep = arr[0].id;
        for (let i = 1; i < arr.length; i++) deleteIds2.push(arr[i].id);
        if (opId) this.gateway.broadcast(opId, 'data', `[${h.id}] 同名容器(${name}) 保留最新 ${keep}，删除 ${arr.length - 1} 条`);
      }
      if (deleteIds2.length) {
        await this.prisma.container.deleteMany({ where: { id: { in: deleteIds2 } } });
        removed += deleteIds2.length;
      }
    }
    if (opId) this.gateway.broadcast(opId, 'end', { removed });
    return removed;
  }

  async purgeContainers(hostId?: string | 'all', opId?: string): Promise<number> {
    const where = hostId && hostId !== 'all' ? { hostId } : {};
    const res = await this.prisma.container.deleteMany({ where } as any);
    const removed = (res as any)?.count ?? 0;
    if (opId) this.gateway.broadcast(opId, 'end', { removed });
    return removed;
  }

  async checkComposeProjectUpdates(hostId: string, composeProject: string, opId?: string): Promise<{ updated: number; projectName: string; error?: string }> {
    try {
      // 获取主机凭据
      const hostCred = await this.getHostCredById(hostId);
      if (!hostCred) {
        return { updated: 0, projectName: composeProject, error: '无法获取主机凭据' };
      }

      // 获取该 Compose 项目的所有容器
      const containers = await this.prisma.container.findMany({ 
        where: { 
          hostId, 
          composeProject,
          imageName: { not: null } 
        } 
      });

      if (containers.length === 0) {
        if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] Compose 项目 ${composeProject} 中没有找到容器`);
        return { updated: 0, projectName: composeProject };
      }

      if (opId) {
        this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 开始检查 Compose 项目 ${composeProject} 的 ${containers.length} 个容器更新...`);
      }

      let marked = 0;
      let failed = 0;

      for (const c of containers) {
        const imageRef = c.imageTag ? `${c.imageName}:${c.imageTag}` : c.imageName || '';
        if (!imageRef) continue;

        try {
          // 第一件事：inspect 现有容器，更新数据库中的信息
          if (opId) {
            this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 正在获取容器 ${c.name} 的最新状态...`);
          }

          try {
            // 获取容器的最新状态信息
            const containerDetails = await this.docker.inspectContainers(hostCred, [c.containerId]);
            if (containerDetails && containerDetails.length > 0) {
              const containerInfo = containerDetails[0];
              
              // 提取容器信息
              const state = containerInfo.State?.Status || c.state;
              const status = containerInfo.State?.Status || c.status;
              const restartCount = containerInfo.RestartCount || c.restartCount;
              const startedAt = containerInfo.State?.StartedAt ? new Date(containerInfo.State.StartedAt) : c.startedAt;
              
              // 提取端口信息
              const ports = containerInfo.NetworkSettings?.Ports || c.ports;
              
              // 提取挂载信息
              const mounts = containerInfo.Mounts || c.mounts;
              
              // 提取网络信息
              const networks = containerInfo.NetworkSettings?.Networks || c.networks;
              
              // 提取标签信息
              const labels = containerInfo.Config?.Labels || c.labels;
              
              // 提取镜像 digest
              const repoDigest = containerInfo.Image || c.repoDigest;
              
              // 更新数据库中的容器信息
              await this.prisma.container.update({
                where: { id: c.id },
                data: {
                  state,
                  status,
                  restartCount,
                  startedAt,
                  ports,
                  mounts,
                  networks,
                  labels,
                  repoDigest,
                }
              });

              if (opId) {
                this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ✓ 容器 ${c.name} 状态已更新`);
              }
            }
          } catch (inspectError) {
            this.logger.warn(`获取容器 ${c.name} 状态信息失败: ${inspectError instanceof Error ? inspectError.message : String(inspectError)}`);
            if (opId) {
              this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ⚠️ 获取容器 ${c.name} 状态失败，继续检查更新...`);
            }
          }

          // 从容器的labels中提取平台信息
          const labels = (c.labels as any) || {};
          const platform = {
            architecture: labels['__platform_arch'] || 'amd64',
            os: labels['__platform_os'] || 'linux'
          };

          // 使用新的方法检查镜像更新，不会实际拉取镜像，并考虑平台匹配
          if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] 检查镜像 ${imageRef} 的远程版本 (${platform.architecture}/${platform.os})...`);
          
          const updateResult = await this.docker.checkImageUpdate(hostCred, imageRef, c.repoDigest, platform);
          
          if (updateResult.error) {
            // 如果无法获取远程信息，记录警告但继续处理其他容器
            this.logger.warn(`检查镜像 ${imageRef} 更新失败: ${updateResult.error}`);
            
            // 检查是否是速率限制错误
            if ((updateResult as any).rateLimited) {
              if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ⚠️ ${imageRef}: Docker Hub 速率限制，已尝试镜像加速器但仍失败`);
              this.logger.warn(`镜像 ${imageRef} 遇到 Docker Hub 速率限制`);
            } else {
              if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ❌ 跳过 ${imageRef}: ${updateResult.error}`);
            }
            
            failed++;
            
            // 更新检查时间，但不更新 updateAvailable 状态
            await this.prisma.container.update({ 
              where: { id: c.id }, 
              data: { updateCheckedAt: new Date() } 
            });
            continue;
          }

          const { updateAvailable, remoteDigest } = updateResult;
          
          if (opId) {
            if (updateAvailable) {
              this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ✓ ${c.name} (${imageRef}) 有更新可用 (${platform.architecture}/${platform.os})`);
            } else {
              this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ✓ ${c.name} (${imageRef}) 已是最新版本 (${platform.architecture}/${platform.os})`);
            }
          }

          // 更新数据库中的状态
          await this.prisma.container.update({ 
            where: { id: c.id }, 
            data: { 
              remoteDigest: remoteDigest || null, 
              updateAvailable, 
              updateCheckedAt: new Date() 
            } 
          });

          if (updateAvailable) marked++;

        } catch (error) {
          this.logger.error(`检查容器 ${c.name} (${imageRef}) 更新时发生错误: ${error instanceof Error ? error.message : String(error)}`);
          if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ❌ ${imageRef} 检查失败: ${error instanceof Error ? error.message : '未知错误'}`);
          failed++;
          
          // 即使失败也更新检查时间
          try {
            await this.prisma.container.update({ 
              where: { id: c.id }, 
              data: { updateCheckedAt: new Date() } 
            });
          } catch {}
        }
      }

      const summary = `Compose 项目 ${composeProject} 检查完成: ${marked} 个可更新, ${failed} 个失败, ${containers.length - marked - failed} 个最新`;
      if (opId) this.gateway.broadcast(opId, 'data', `[${hostCred.address}] ${summary}`);
      this.logger.log(`[${hostCred.address}] ${summary}`);

      return { updated: marked, projectName: composeProject };
    } catch (error) {
      this.logger.error(`检查 Compose 项目 ${composeProject} 更新失败: ${error instanceof Error ? error.message : String(error)}`);
      return { updated: 0, projectName: composeProject, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

