import { Injectable } from '@nestjs/common';
import { DockerExecService } from './docker-exec.service';

@Injectable()
export class DockerContainerService {
  constructor(private readonly dockerExec: DockerExecService) {}

  async psByComposeProject(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    project: string,
    timeoutSec = 60,
  ): Promise<any[]> {
    const { code, stdout } = await this.dockerExec.exec(
      host,
      ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{json .}}'],
      timeoutSec,
    );
    if (code !== 0) return [];
    const lines = stdout.split('\n').filter(Boolean);
    const items: any[] = [];
    for (const line of lines) { try { items.push(JSON.parse(line)); } catch {} }
    return items;
  }

  async composeLs(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    timeoutSec = 60,
  ): Promise<Array<{ Name?: string; Status?: string; Running?: number; Stopped?: number; WorkingDir?: string }>> {
    const { code, stdout } = await this.dockerExec.exec(host, ['compose', 'ls', '--format', 'json'], timeoutSec);
    if (code !== 0) return [];
    const text = stdout.trim();
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed as any[];
      // some versions output one JSON per line
      const lines = text.split('\n').filter(Boolean);
      const arr: any[] = [];
      for (const line of lines) { try { arr.push(JSON.parse(line)); } catch {} }
      return arr;
    } catch {
      // fallback: try parse table (Name\tStatus...)
      const lines = text.split('\n').filter(Boolean);
      const arr: any[] = [];
      for (const line of lines.slice(1)) {
        const cols = line.trim().split(/\s{2,}/);
        if (cols.length >= 2) arr.push({ Name: cols[0], Status: cols[1] });
      }
      return arr;
    }
  }

  async inspectContainers(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    containerIds: string[],
    timeoutSec = 120,
  ): Promise<any[]> {
    if (!containerIds.length) {
      return [];
    }

    // Inspect all containers in a single command for efficiency
    const { code, stdout, stderr } = await this.dockerExec.exec(host, ['inspect', ...containerIds], timeoutSec);

    if (code !== 0) {
      // Log the error but don't throw, as some containers might be gone
      console.warn(`'docker inspect' failed for some containers on ${host.address}. Stderr: ${stderr}`);
      return [];
    }

    try {
      // When inspecting multiple containers, Docker returns a JSON array of objects.
      const parsed = JSON.parse(stdout.trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error(`Failed to parse JSON from 'docker inspect' on ${host.address}:`, e);
      return [];
    }
  }

  // 获取容器的平台信息
  async getContainerPlatform(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    containerId: string,
  ): Promise<{ architecture?: string; os?: string; error?: string }> {
    try {
      // 首先尝试从容器inspect中获取镜像ID，然后检查镜像平台
      const { code, stdout } = await this.dockerExec.exec(host, ['inspect', '--format', '{{.Image}}', containerId], 30);
      if (code !== 0) {
        return { error: '无法获取容器镜像ID' };
      }

      const imageId = stdout.trim();
      if (!imageId) {
        return { error: '容器镜像ID为空' };
      }

      // 检查镜像的平台信息
      const { code: code2, stdout: stdout2, stderr: stderr2 } = await this.dockerExec.exec(
        host,
        ['inspect', '--format', '{{.Architecture}} {{.Os}}', imageId],
        30,
      );
      if (code2 === 0 && stdout2.trim() && !stderr2.includes('template parsing error')) {
        const parts = stdout2.trim().split(' ');
        if (parts.length >= 2) {
          return {
            architecture: parts[0] || 'amd64',
            os: parts[1] || 'linux',
          };
        }
      }

      // 如果上面的方法失败，尝试从系统信息推断（通常容器运行在宿主机同架构上）
      const { code: code3, stdout: stdout3, stderr: stderr3 } = await this.dockerExec.exec(host, ['version', '--format', '{{.Server.Arch}}'], 30);
      if (code3 === 0 && stdout3.trim() && !stderr3.includes('template parsing error')) {
        return {
          architecture: stdout3.trim(),
          os: 'linux', // Docker 主要运行在 Linux 上
        };
      }

      // 默认假设为最常见的平台
      return {
        architecture: 'amd64',
        os: 'linux',
      };
    } catch (error) {
      return { error: `获取平台信息失败: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  // 获取容器实际运行的镜像 digest（从 docker inspect 的 Image 字段）
  async getContainerImageDigest(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    containerId: string,
  ): Promise<string | null> {
    try {
      const { code, stdout } = await this.dockerExec.exec(host, ['inspect', '--format', '{{.Image}}', containerId], 30);
      if (code === 0 && stdout.trim()) {
        const imageId = stdout.trim();
        if (imageId.startsWith('sha256:')) {
          return imageId;
        }

        // Try to get RepoDigests, but handle errors gracefully
        // Some images might not have RepoDigests or the imageId might be invalid
        const { code: code2, stdout: stdout2, stderr: stderr2 } = await this.dockerExec.exec(
          host,
          ['inspect', '--format', '{{json .RepoDigests}}', imageId],
          30,
        );

        // Only proceed if the command succeeded and didn't produce template errors
        if (code2 === 0 && stdout2.trim() && !stderr2.includes('template parsing error')) {
          try {
            const repoDigests = JSON.parse(stdout2.trim());
            if (Array.isArray(repoDigests) && repoDigests.length > 0) {
              const repoDigest = repoDigests[0];
              const digestMatch = repoDigest.match(/@(sha256:[a-f0-9]+)/);
              if (digestMatch) {
                return digestMatch[1];
              }
              return repoDigest; // Fallback to the full string if no @ is found
            }
          } catch (e) {
            // JSON parsing failed, return the imageId as fallback
          }
        }

        // If RepoDigests inspection failed, return the imageId as is
        return imageId;
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}
