import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateManualPortDto } from './dto/manual-port.dto';
import { Prisma } from '@prisma/client';
import { ContainerDiscoveryService } from './container-discovery.service';
import { ContainerLifecycleService } from './container-lifecycle.service';
import { ContainerUpdateService } from './container-update.service';
import { ContainerComposeService } from './container-compose.service';
import { ContainerStatusService } from './container-status.service';

@Injectable()
export class ContainersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discoveryService: ContainerDiscoveryService,
    private readonly lifecycleService: ContainerLifecycleService,
    private readonly updateService: ContainerUpdateService,
    private readonly composeService: ContainerComposeService,
    private readonly statusService: ContainerStatusService,
  ) {}

  // List containers with filtering
  async list(params: { hostId?: string; hostName?: string; q?: string; updateAvailable?: boolean | undefined; isComposeManaged?: boolean | undefined }) {
    const where: any = {};
    if (params.hostId) {
      where.hostId = params.hostId;
    } else if (params.hostName) {
      const host = await this.prisma.host.findFirst({ where: { name: params.hostName } });
      if (host) {
        where.hostId = host.id;
      } else {
        return { items: [] };
      }
    }
    if (typeof params.updateAvailable === 'boolean') where.updateAvailable = params.updateAvailable;
    if (typeof params.isComposeManaged === 'boolean') where.isComposeManaged = params.isComposeManaged;
    if (params.q) where.OR = [{ name: { contains: params.q } }, { imageName: { contains: params.q } }];
    const items = await this.prisma.container.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        host: {
          select: {
            name: true,
          },
        },
      },
    });
    return { items };
  }

  // Manual port mapping management
  async updateManualPortMapping(containerId: string, dto: UpdateManualPortDto) {
    const { exposedPort, internalPort } = dto;
    return this.prisma.container.update({
      where: { id: containerId },
      data: { manualPortMapping: { exposedPort, internalPort } },
    });
  }

  async deleteManualPortMapping(containerId: string) {
    return this.prisma.container.update({
      where: { id: containerId },
      data: { manualPortMapping: Prisma.DbNull },
    });
  }

  // Discovery operations - delegate to ContainerDiscoveryService
  async discover(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    return this.discoveryService.discover(bodyHost);
  }

  async discoverMultiple(hostIds: string[]): Promise<{ taskId: string }> {
    return this.discoveryService.discoverMultiple(hostIds);
  }

  async discoverOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    return this.discoveryService.discoverOnHost(host);
  }

  // Lifecycle operations - delegate to ContainerLifecycleService
  async restartOne(hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    return this.lifecycleService.restartOne(hostOrRef, containerId, existingOpId);
  }

  async startOne(hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    return this.lifecycleService.startOne(hostOrRef, containerId, existingOpId);
  }

  async stopOne(hostOrRef: { id: string }, containerId: string, existingOpId?: string) {
    return this.lifecycleService.stopOne(hostOrRef, containerId, existingOpId);
  }

  // Update operations - delegate to ContainerUpdateService
  async updateOne(hostOrRef: { id: string }, containerId: string, imageRef?: string, existingOpId?: string) {
    return this.updateService.updateOne(hostOrRef, containerId, imageRef, existingOpId);
  }

  async checkUpdates(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    return this.updateService.checkUpdates(bodyHost);
  }

  async checkUpdatesOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    return this.updateService.checkUpdatesOnHost(host);
  }

  // Compose operations - delegate to ContainerComposeService
  async composeOperate(
    hostOrRef: { id: string },
    operation: 'up' | 'down' | 'restart' | 'pull' | 'stop' | 'start',
    project: string,
    workingDir: string,
    services?: string[],
  ): Promise<{ taskId: string }> {
    return this.composeService.operate(hostOrRef, operation, project, workingDir, services);
  }

  async getComposeConfig(hostOrRef: { id: string }, project: string, workingDir: string): Promise<any> {
    return this.composeService.getComposeConfig(hostOrRef, project, workingDir);
  }

  async listComposeProjects(hostOrRef: { id: string }): Promise<any[]> {
    return this.composeService.listComposeProjects(hostOrRef);
  }

  async reactivateComposeProject(hostOrRef: { id: string }, project: string, workingDir: string): Promise<{ taskId: string }> {
    return this.composeService.reactivateComposeProject(hostOrRef, project, workingDir);
  }

  async getComposeDownProjects(hostId?: string): Promise<any[]> {
    return this.composeService.getComposeDownProjects(hostId);
  }

  async getComposeServices(hostOrRef: { id: string }, project: string, workingDir: string): Promise<string[]> {
    return this.composeService.getComposeServices(hostOrRef, project, workingDir);
  }

  async getComposeStatus(hostOrRef: { id: string }, project: string, workingDir: string): Promise<any[]> {
    return this.composeService.getComposeStatus(hostOrRef, project, workingDir);
  }

  // Status operations - delegate to ContainerStatusService
  async refreshStatusOnHost(host: { id: string; address: string; sshUser: string; port?: number }): Promise<void> {
    return this.statusService.refreshStatusOnHost(host);
  }

  async cleanupDuplicates(): Promise<{ taskId: string }> {
    return this.statusService.cleanupDuplicates();
  }

  async purgeStoppedContainers(hostOrRef: { id: string }): Promise<{ taskId: string }> {
    return this.statusService.purgeStoppedContainers(hostOrRef);
  }

  async getContainerLogs(containerId: string, lines: number = 100): Promise<string> {
    return this.statusService.getContainerLogs(containerId, lines);
  }

  async getContainerStats(containerId: string): Promise<any> {
    return this.statusService.getContainerStats(containerId);
  }

  // Legacy methods for backward compatibility
  async checkUpdatesAny(bodyHost: { id?: string } | { id: 'all' }): Promise<{ taskId: string }> {
    return this.checkUpdates(bodyHost);
  }

  async checkSingleContainerUpdate(containerId: string): Promise<{ taskId: string }> {
    // Get container info and check updates for its host
    const container = await this.prisma.container.findUnique({
      where: { id: containerId },
      include: { host: true },
    });

    if (!container) {
      throw new Error('Container not found');
    }

    return this.checkUpdates({ id: container.hostId });
  }

  async checkComposeProjectUpdates(hostId: string, _composeProject: string): Promise<{ taskId: string }> {
    // This could be implemented as a specialized method in ContainerUpdateService
    // For now, we'll just check updates for the entire host
    return this.checkUpdates({ id: hostId });
  }

  // Legacy refresh status method with overloaded signature
  async refreshStatus(
    hostIdOrBodyHost: string | { id?: string } | { id: 'all' },
    _options?: { containerIds?: string[]; containerNames?: string[]; composeProject?: string },
  ): Promise<{ taskId: string }> {
    if (typeof hostIdOrBodyHost === 'string') {
      // Legacy call with hostId and options
      // For now, just refresh the entire host
      return this.statusService.refreshStatus({ id: hostIdOrBodyHost });
    } else {
      // New call with bodyHost
      return this.statusService.refreshStatus(hostIdOrBodyHost);
    }
  }
}