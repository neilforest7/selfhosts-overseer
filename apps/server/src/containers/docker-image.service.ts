import { Injectable } from '@nestjs/common';
import { DockerExecService } from './docker-exec.service';
import { SettingsService } from '../settings/settings.service';

@Injectable()
export class DockerImageService {
  constructor(
    private readonly dockerExec: DockerExecService,
    private readonly settings: SettingsService,
  ) {}

  async inspectImageRepoDigests(
    host: { address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<string[]> {
    const { code, stdout, stderr } = await this.dockerExec.exec(host, ['inspect', '--format', '{{json .RepoDigests}}', imageRef], 60);
    // Check for both exit code and template parsing errors
    if (code !== 0 || stderr.includes('template parsing error')) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async inspectImageRepoTags(
    host: { address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<string[]> {
    const { code, stdout, stderr } = await this.dockerExec.exec(host, ['inspect', '--format', '{{json .RepoTags}}', imageRef], 60);
    // Check for both exit code and template parsing errors
    if (code !== 0 || stderr.includes('template parsing error')) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async resolveImageNameTag(
    host: { address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<{ imageName?: string; imageTag?: string }> {
    if (!imageRef) return {};
    // Prefer human-friendly RepoTags
    const tags = await this.inspectImageRepoTags(host, imageRef);
    const pick = tags.find(t => t.includes(':')) || tags[0];
    const ref = pick || imageRef;
    // Strip digest if present
    const atIdx = ref.indexOf('@');
    const cleanRef = atIdx >= 0 ? ref.slice(0, atIdx) : ref;
    if (cleanRef.includes(':')) {
      const i = cleanRef.lastIndexOf(':');
      return { imageName: cleanRef.slice(0, i), imageTag: cleanRef.slice(i + 1) };
    }
    return { imageName: cleanRef, imageTag: undefined };
  }

  async pullImage(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<number> {
    const { code } = await this.dockerExec.exec(host, ['pull', imageRef], 300);
    return code;
  }

  // 检查镜像是否来自 Docker Hub
  private isDockerHubImage(imageRef: string): boolean {
    // Docker Hub 镜像的特征：
    // 1. 没有 registry 前缀的镜像（如 nginx, ubuntu）
    // 2. 以 docker.io 开头的镜像
    // 3. library/ 开头的官方镜像
    if (imageRef.includes('docker.io') || imageRef.includes('registry-1.docker.io')) {
      return true;
    }

    // 如果没有斜杠，通常是官方镜像（如 nginx:latest）
    if (!imageRef.includes('/')) {
      return true;
    }

    // 如果只有一个斜杠且没有域名，通常是 Docker Hub 用户镜像（如 user/image）
    const parts = imageRef.split('/');
    if (parts.length === 2 && !parts[0].includes('.')) {
      return true;
    }

    return false;
  }

  // 确保 Docker Hub 认证
  private async ensureDockerAuth(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // 检查是否已经登录
      const { code: loginCheckCode } = await this.dockerExec.exec(host, ['info'], 30);
      if (loginCheckCode !== 0) {
        return { success: false, error: 'Docker daemon 不可用' };
      }

      // 使用配置的 Docker 凭证进行登录
      const appSettings = await this.settings.get();

      if (
        appSettings.dockerCredentialsEnabled &&
        appSettings.dockerCredentialsUsername &&
        appSettings.dockerCredentialsPersonalAccessToken
      ) {
        // 尝试使用配置的凭证登录
        const loginCmd = `echo "${appSettings.dockerCredentialsPersonalAccessToken}" | docker login --username "${appSettings.dockerCredentialsUsername}" --password-stdin`;
        const { code: loginCode, stderr: loginStderr } = await this.dockerExec.execShell(host, loginCmd);

        if (loginCode === 0) {
          return { success: true };
        } else {
          return { success: false, error: `Docker Hub 登录失败: ${loginStderr}` };
        }
      }

      // 如果没有配置凭据，返回失败但不是错误
      return { success: false, error: '未配置 Docker Hub 凭据' };
    } catch (error) {
      return { success: false, error: `Docker 认证过程出错: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // 使用镜像加速器（中国镜像源）
  private async tryMirrorRegistries(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    imageRef: string,
    platform?: { architecture?: string; os?: string },
  ): Promise<{ digest?: string; manifestDigest?: string; error?: string }> {
    // 常用的 Docker 镜像加速器
    const mirrors = [
      'docker.m.daocloud.io', // DaoCloud
      'dockerproxy.com', // Docker Proxy
      'docker.nju.edu.cn', // 南京大学
      'docker.mirrors.ustc.edu.cn', // 中科大
    ];

    for (const mirror of mirrors) {
      try {
        // 只对 Docker Hub 镜像使用加速器
        if (!this.isDockerHubImage(imageRef)) {
          continue;
        }

        // 构造镜像加速器URL
        let mirrorImageRef = imageRef;
        if (!imageRef.includes('/')) {
          // 官方镜像需要添加 library/ 前缀
          mirrorImageRef = `${mirror}/library/${imageRef}`;
        } else if (!imageRef.includes('.')) {
          // 用户镜像直接添加镜像源前缀
          mirrorImageRef = `${mirror}/${imageRef}`;
        }

        const { code, stdout, stderr } = await this.dockerExec.exec(host, ['manifest', 'inspect', mirrorImageRef], 30);

        if (code === 0) {
          try {
            const manifest = JSON.parse(stdout.trim());

            // 处理多架构镜像
            if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
              if (platform && (platform.architecture || platform.os)) {
                const targetArch = platform.architecture || 'amd64';
                const targetOS = platform.os || 'linux';

                const matchedManifest = manifest.manifests.find((m: any) => {
                  const p = m.platform || {};
                  return (
                    (p.architecture === targetArch || (!p.architecture && targetArch === 'amd64')) &&
                    (p.os === targetOS || (!p.os && targetOS === 'linux'))
                  );
                });

                if (matchedManifest) {
                  return {
                    digest: matchedManifest.digest,
                    manifestDigest: matchedManifest.digest,
                  };
                }
              }

              return {
                digest: manifest.manifests[0].digest,
                manifestDigest: manifest.manifests[0].digest,
              };
            }

            // 单架构镜像
            if (manifest.config && manifest.config.digest) {
              return {
                digest: manifest.config.digest,
                manifestDigest: manifest.config.digest,
              };
            }
          } catch (parseError) {
            continue; // 尝试下一个镜像源
          }
        }
      } catch (error) {
        continue; // 尝试下一个镜像源
      }
    }

    return { error: '所有镜像加速器均无法访问' };
  }

  // 获取远程镜像的 manifest 信息，用于检查更新而不实际拉取镜像
  async inspectRemoteManifest(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    imageRef: string,
    platform?: { architecture?: string; os?: string },
  ): Promise<{ digest?: string; manifestDigest?: string; error?: string; rateLimited?: boolean }> {
    // 检查是否需要 Docker Hub 认证
    const needsAuth = this.isDockerHubImage(imageRef);

    // 如果是 Docker Hub 镜像且可能遇到速率限制，尝试使用认证
    if (needsAuth) {
      const authResult = await this.ensureDockerAuth(host);
      if (!authResult.success) {
        // 如果认证失败，记录警告但继续尝试
        console.warn(`Docker Hub 认证失败: ${authResult.error}`);
      }
    }

    // 尝试使用 docker manifest inspect 获取远程镜像信息，带重试机制
    const { code, stdout, stderr } = await this.dockerExec.execWithRetry(host, ['manifest', 'inspect', imageRef], 90, 3);

    if (code === 0) {
      try {
        const manifest = JSON.parse(stdout.trim());

        // 对于 manifest list (multi-arch)
        if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
          // 如果提供了平台信息，尝试匹配对应平台的 manifest
          if (platform && (platform.architecture || platform.os)) {
            const targetArch = platform.architecture || 'amd64';
            const targetOS = platform.os || 'linux';

            // 查找匹配的平台
            const matchedManifest = manifest.manifests.find((m: any) => {
              const p = m.platform || {};
              return (
                (p.architecture === targetArch || (!p.architecture && targetArch === 'amd64')) &&
                (p.os === targetOS || (!p.os && targetOS === 'linux'))
              );
            });

            if (matchedManifest) {
              return {
                digest: matchedManifest.digest,
                manifestDigest: matchedManifest.digest,
              };
            }

            // 如果没有找到精确匹配，记录警告并使用第一个已知平台的 manifest
            const knownPlatformManifest = manifest.manifests.find((m: any) => {
              const p = m.platform || {};
              return p.architecture && p.architecture !== 'unknown' && p.os && p.os !== 'unknown';
            });

            if (knownPlatformManifest) {
              return {
                digest: knownPlatformManifest.digest,
                manifestDigest: knownPlatformManifest.digest,
              };
            }
          }

          // 默认使用第一个 manifest
          return {
            digest: manifest.manifests[0].digest,
            manifestDigest: manifest.manifests[0].digest,
          };
        }

        // 对于单个 manifest
        if (manifest.config && manifest.config.digest) {
          return {
            digest: manifest.config.digest,
            manifestDigest: manifest.config.digest,
          };
        }

        // 如果有 mediaType 和 config，这是一个有效的 manifest
        if (manifest.mediaType && manifest.config) {
          if (manifest.config.digest) {
            return {
              digest: manifest.config.digest,
              manifestDigest: manifest.config.digest,
            };
          }
        }
      } catch (error) {
        return { error: `解析 manifest 失败: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    // 检查是否是速率限制错误
    const isRateLimited = stderr.includes('toomanyrequests') || stderr.includes('Too Many Requests');

    // 如果遇到速率限制且是 Docker Hub 镜像，尝试使用镜像加速器
    if (isRateLimited && this.isDockerHubImage(imageRef)) {
      const mirrorResult = await this.tryMirrorRegistries(host, imageRef, platform);
      if (!mirrorResult.error) {
        return mirrorResult;
      }
    }

    // 如果 manifest inspect 失败，回退到使用 buildx imagetools inspect
    // 先尝试带 --raw 标志（新版本Docker支持），使用重试机制
    let { code: code2, stdout: stdout2, stderr: stderr2 } = await this.dockerExec.execWithRetry(
      host,
      ['buildx', 'imagetools', 'inspect', imageRef, '--raw'],
      90,
      2,
    );

    // 如果 --raw 标志不被支持，尝试不带 --raw 标志
    if (code2 !== 0 && stderr2.includes('unknown flag: --raw')) {
      const result = await this.dockerExec.execWithRetry(host, ['buildx', 'imagetools', 'inspect', imageRef], 90, 2);
      code2 = result.code;
      stdout2 = result.stdout;
      stderr2 = result.stderr;
    }

    if (code2 === 0) {
      try {
        const manifest = JSON.parse(stdout2.trim());
        // 处理不同格式的输出
        if (manifest.config && manifest.config.digest) {
          return { digest: manifest.config.digest };
        }
        // 如果是 manifest list，取第一个
        if (manifest.manifests && Array.isArray(manifest.manifests) && manifest.manifests.length > 0) {
          return { digest: manifest.manifests[0].digest };
        }
        // 如果直接包含 digest
        if (manifest.digest) {
          return { digest: manifest.digest };
        }
      } catch (error) {
        return { error: `解析 buildx manifest 失败: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    // buildx 也可能遇到速率限制，再次尝试镜像加速器
    const isRateLimited2 = stderr2.includes('toomanyrequests') || stderr2.includes('Too Many Requests');
    if (isRateLimited2 && this.isDockerHubImage(imageRef)) {
      const mirrorResult = await this.tryMirrorRegistries(host, imageRef, platform);
      if (!mirrorResult.error) {
        return mirrorResult;
      }
    }

    // 最后回退：使用 skopeo（如果可用）
    const { code: code3, stdout: stdout3 } = await this.dockerExec.exec(
      host,
      ['run', '--rm', 'quay.io/skopeo/stable', 'inspect', `docker://${imageRef}`],
      120,
    );

    if (code3 === 0) {
      try {
        const info = JSON.parse(stdout3.trim());
        if (info.Digest) {
          return { digest: info.Digest };
        }
      } catch (error) {
        return { error: `解析 skopeo 输出失败: ${error instanceof Error ? error.message : String(error)}` };
      }
    }

    return {
      error: `无法获取远程镜像信息: manifest inspect 失败 (${stderr.trim()}), buildx imagetools 失败 (${stderr2.trim()}), skopeo 失败`,
      rateLimited: isRateLimited || isRateLimited2,
    };
  }

  async checkImageUpdate(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    imageRef: string,
    currentDigest?: string | null,
    platform?: { architecture?: string; os?: string },
  ): Promise<{ updateAvailable: boolean; remoteDigest?: string; error?: string }> {
    const manifestResult = await this.inspectRemoteManifest(host, imageRef, platform);

    if (manifestResult.error) {
      return { updateAvailable: false, error: manifestResult.error };
    }

    const remoteDigest = manifestResult.digest;
    if (!remoteDigest) {
      return { updateAvailable: false, error: '无法获取远程镜像 digest' };
    }

    let localDigest = currentDigest;
    if (!localDigest) {
      const localDigests = await this.inspectImageRepoDigests(host, imageRef);
      localDigest = localDigests[0] || null;
    }

    const updateAvailable = Boolean(localDigest && remoteDigest && localDigest !== remoteDigest);

    return {
      updateAvailable,
      remoteDigest,
      error: undefined,
    };
  }
}
