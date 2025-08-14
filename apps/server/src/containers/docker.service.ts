import { Injectable } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { SshService } from '../ssh/ssh.service';

@Injectable()
export class DockerService {
  constructor(private readonly ssh: SshService) {}

  async execShell(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, shellCommand: string, timeoutSec = 60): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    const isLocal = host.address === '127.0.0.1' || host.address === 'localhost';
    const escaped = shellCommand.replace(/'/g, "'\"'\"'");
    const wrapped = `sh -lc '${escaped}'`;
    if (isLocal) {
      return new Promise((resolve) => {
        const p = spawn('sh', ['-lc', shellCommand]);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutSec * 1000);
        p.stdout.setEncoding('utf8');
        p.stderr.setEncoding('utf8');
        p.stdout.on('data', (d) => (stdout += d));
        p.stderr.on('data', (d) => (stderr += d));
        p.on('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr, cmd: `sh -lc '${escaped}'` }); });
        p.on('error', () => { clearTimeout(timer); resolve({ code: 1, stdout, stderr, cmd: `sh -lc '${escaped}'` }); });
      });
    }
    const res = await this.ssh.executeCapture({
      host: host.address,
      user: host.sshUser,
      port: host.port,
      command: wrapped,
      connectTimeoutSeconds: Math.min(30, Math.max(5, Math.floor(timeoutSec / 2))),
      killAfterSeconds: timeoutSec,
      hostKeyCheckingMode: 'yes',
      password: host.password,
      privateKey: host.privateKey,
      privateKeyPassphrase: host.privateKeyPassphrase
    });
    const cmd = `ssh -o StrictHostKeyChecking=yes ${host.sshUser}@${host.address} -- ${wrapped}`;
    return { code: res.code, stdout: res.stdout, stderr: res.stderr, cmd };
  }

  async exec(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, args: string[], timeoutSec = 60): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    const isLocal = host.address === '127.0.0.1' || host.address === 'localhost';
    const dockerCmd = ['docker', ...args].join(' ');
    const escaped = dockerCmd.replace(/'/g, "'\"'\"'");
    const wrapped = `sh -lc '${escaped}'`;
    if (isLocal) {
      // 本机也走统一的 shell 包裹，避免 format/转义差异
      return new Promise((resolve) => {
        const p = spawn('sh', ['-lc', dockerCmd]);
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} }, timeoutSec * 1000);
        p.stdout.setEncoding('utf8');
        p.stderr.setEncoding('utf8');
        p.stdout.on('data', (d) => (stdout += d));
        p.stderr.on('data', (d) => (stderr += d));
        p.on('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? 1, stdout, stderr, cmd: `sh -lc '${escaped}'` }); });
        p.on('error', () => { clearTimeout(timer); resolve({ code: 1, stdout, stderr, cmd: `sh -lc '${escaped}'` }); });
      });
    }
    const res = await this.ssh.executeCapture({
      host: host.address,
      user: host.sshUser,
      port: host.port,
      command: wrapped,
      connectTimeoutSeconds: Math.min(30, Math.max(5, Math.floor(timeoutSec / 2))),
      killAfterSeconds: timeoutSec,
      hostKeyCheckingMode: 'yes',
      password: host.password,
      privateKey: host.privateKey,
      privateKeyPassphrase: host.privateKeyPassphrase
    });
    const cmd = `ssh -o StrictHostKeyChecking=yes ${host.sshUser}@${host.address} -- ${wrapped}`;
    return { code: res.code, stdout: res.stdout, stderr: res.stderr, cmd };
  }

  async inspectImageRepoDigests(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<string[]> {
    const { code, stdout } = await this.exec(host, ['inspect', '--format', '{{json .RepoDigests}}', imageRef], 60);
    if (code !== 0) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async inspectImageRepoTags(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<string[]> {
    const { code, stdout } = await this.exec(host, ['inspect', '--format', '{{json .RepoTags}}', imageRef], 60);
    if (code !== 0) return [];
    try {
      const arr = JSON.parse(stdout.trim());
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  async resolveImageNameTag(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<{ imageName?: string; imageTag?: string }> {
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

  async psByComposeProject(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, project: string, timeoutSec = 60): Promise<any[]> {
    const { code, stdout } = await this.exec(host, ['ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, `--format='{{json .}}'`], timeoutSec);
    if (code !== 0) return [];
    const lines = stdout.split('\n').filter(Boolean);
    const items: any[] = [];
    for (const line of lines) {
      try { items.push(JSON.parse(line)); } catch {}
    }
    return items;
  }

  async composeLs(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, timeoutSec = 60): Promise<Array<{ Name?: string; Status?: string; Running?: number; Stopped?: number; WorkingDir?: string }>> {
    const { code, stdout } = await this.exec(host, ['compose', 'ls', '--format', 'json'], timeoutSec);
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

  async inspectContainers(host: { address: string; sshUser: string; port?: number; password?: string; privateKey?: string; privateKeyPassphrase?: string }, containerIds: string[], timeoutSec = 120): Promise<any[]> {
    if (!containerIds.length) return [];
    const results: any[] = [];
    for (const id of containerIds) {
      const res = await this.exec(host, ['inspect', id], timeoutSec);
      if (res.code !== 0) continue;
      try {
        const parsed = JSON.parse(res.stdout.trim());
        if (Array.isArray(parsed) && parsed[0]) results.push(parsed[0]);
        else if (parsed) results.push(parsed);
      } catch {
        // ignore this id
      }
    }
    return results;
  }

  async pullImage(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<number> {
    const { code } = await this.exec(host, ['pull', imageRef], 300);
    return code;
  }
}

