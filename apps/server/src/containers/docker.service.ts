import { Injectable } from '@nestjs/common';
import { DockerExecService } from './docker-exec.service';
import { DockerContainerService } from './docker-container.service';
import { DockerImageService } from './docker-image.service';

@Injectable()
export class DockerService {
  constructor(
    private readonly dockerExec: DockerExecService,
    private readonly dockerContainer: DockerContainerService,
    private readonly dockerImage: DockerImageService,
  ) {}

  // Execution methods - delegate to DockerExecService
  async exec(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    args: string[],
    timeoutSec = 60,
  ): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    return this.dockerExec.exec(host, args, timeoutSec);
  }

  async execStreaming(
    host: {
      id: string;
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    args: string[],
    timeoutSec = 60,
  ): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    return this.dockerExec.execStreaming(host, args, timeoutSec);
  }

  async execShell(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    shellCommand: string,
    options: any = {},
  ): Promise<{ code: number; stdout: string | Buffer; stderr: string | Buffer; cmd: string }> {
    return this.dockerExec.execShell(host, shellCommand, options);
  }

  async execWithRetry(
    host: {
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    args: string[],
    timeoutSec = 60,
    maxRetries = 3,
  ): Promise<{ code: number; stdout: string; stderr: string; cmd: string }> {
    return this.dockerExec.execWithRetry(host, args, timeoutSec, maxRetries);
  }

  // Container methods - delegate to DockerContainerService
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
    return this.dockerContainer.inspectContainers(host, containerIds, timeoutSec);
  }

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
    return this.dockerContainer.getContainerImageDigest(host, containerId);
  }

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
    return this.dockerContainer.getContainerPlatform(host, containerId);
  }

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
    return this.dockerContainer.psByComposeProject(host, project, timeoutSec);
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
    return this.dockerContainer.composeLs(host, timeoutSec);
  }

  // Image methods - delegate to DockerImageService
  async inspectImageRepoDigests(
    host: { address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<string[]> {
    return this.dockerImage.inspectImageRepoDigests(host, imageRef);
  }

  async inspectImageRepoTags(
    host: { address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<string[]> {
    return this.dockerImage.inspectImageRepoTags(host, imageRef);
  }

  async resolveImageNameTag(
    host: { address: string; sshUser: string; port?: number },
    imageRef: string,
  ): Promise<{ imageName?: string; imageTag?: string }> {
    return this.dockerImage.resolveImageNameTag(host, imageRef);
  }

  async pullImage(host: { address: string; sshUser: string; port?: number }, imageRef: string): Promise<number> {
    return this.dockerImage.pullImage(host, imageRef);
  }



  async checkImageUpdate(
    host: {
      id: string;
      address: string;
      sshUser: string;
      port?: number;
      password?: string;
      privateKey?: string;
      privateKeyPassphrase?: string;
    },
    imageRef: string,
    currentDigest?: string | null,
  ): Promise<{ updateAvailable: boolean; remoteDigest?: string; error?: string; currentLocalDigest?: string }> {
    return this.dockerImage.checkImageUpdate(host, imageRef, currentDigest);
  }

  async ensureDockerLogin(hostId: string, host: { address: string; sshUser: string; port?: number }): Promise<{ success: boolean; error?: string }> {
    return this.dockerImage.ensureDockerLogin(hostId);
  }
}