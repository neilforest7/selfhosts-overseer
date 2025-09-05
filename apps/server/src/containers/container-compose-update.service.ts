import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';

export interface ComposeUpdateOptions {
  updateStrategy?: 'service-by-service' | 'all-at-once' | 'dependency-order';
  healthCheckTimeout?: number;
  rollbackOnFailure?: boolean;
  preserveVolumes?: boolean;
  recreateContainers?: boolean;
  pullBeforeUpdate?: boolean;
  maxConcurrentServices?: number;
  dependencyWaitTime?: number; // seconds to wait for dependencies
  preUpdateScript?: string;
  postUpdateScript?: string;
}

export interface ComposeUpdateResult {
  success: boolean;
  servicesUpdated: string[];
  servicesFailed: string[];
  dependenciesResolved: boolean;
  rollbackPerformed: boolean;
  duration: number;
  error?: string;
}

export interface ServiceDependency {
  service: string;
  dependsOn: string[];
  healthCheck?: boolean;
  startupTime?: number;
}

@Injectable()
export class ContainerComposeUpdateService {
  private readonly logger = new Logger(ContainerComposeUpdateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
  ) {}

  async updateComposeContainer(
    container: any,
    imageRef?: string,
    options: ComposeUpdateOptions = {},
  ): Promise<ComposeUpdateResult> {
    const startTime = Date.now();
    const result: ComposeUpdateResult = {
      success: false,
      servicesUpdated: [],
      servicesFailed: [],
      dependenciesResolved: false,
      rollbackPerformed: false,
      duration: 0,
    };

    try {
      const hostCred = await this.getHostCredById(container.hostId);
      if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

      if (!container.composeProject || !container.composeWorkingDir) {
        throw new Error('Container is not properly configured for Compose management');
      }

      this.operationLogService.log('info', `Starting enhanced Compose update for service "${container.composeService}" in project "${container.composeProject}"`);

      // Step 1: Analyze dependencies
      const dependencies = await this.analyzeDependencies(hostCred, container, options);
      result.dependenciesResolved = dependencies.length > 0;

      // Step 2: Pre-update validation and preparation
      await this.preUpdateValidation(hostCred, container, options);

      // Step 3: Pull images if requested
      if (options.pullBeforeUpdate !== false) {
        await this.pullComposeImages(hostCred, container, imageRef);
      }

      // Step 4: Execute update based on strategy
      switch (options.updateStrategy) {
        case 'dependency-order':
          await this.updateByDependencyOrder(hostCred, container, dependencies, options, result);
          break;
        case 'all-at-once':
          await this.updateAllAtOnce(hostCred, container, options, result);
          break;
        case 'service-by-service':
        default:
          await this.updateServiceByService(hostCred, container, options, result);
          break;
      }

      // Step 5: Post-update validation
      await this.postUpdateValidation(hostCred, container, options);

      result.success = true;
      result.duration = Date.now() - startTime;
      
      this.operationLogService.log('info', `✅ Enhanced Compose update completed successfully in ${Math.round(result.duration / 1000)}s`);
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `❌ Compose update failed: ${errorMessage}`);
      
      // Attempt rollback if requested
      if (options.rollbackOnFailure) {
        try {
          result.rollbackPerformed = await this.performComposeRollback(container, options);
          this.operationLogService.log('info', `Rollback ${result.rollbackPerformed ? 'completed' : 'failed'}`);
        } catch (rollbackError) {
          this.operationLogService.log('error', `Rollback failed: ${rollbackError}`);
        }
      }

      result.success = false;
      result.duration = Date.now() - startTime;
      result.error = errorMessage;
      
      return result;
    }
  }

  private async analyzeDependencies(hostCred: any, container: any, options: ComposeUpdateOptions): Promise<ServiceDependency[]> {
    this.operationLogService.log('info', `Analyzing service dependencies...`);

    try {
      // Get the compose configuration
      const { code: configCode, stdout: configOutput } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && docker compose config --format json`,
        { timeout: 60 }
      );

      if (configCode !== 0) {
        this.operationLogService.log('info', `Could not analyze dependencies: compose config failed`);
        return [];
      }

      const composeConfig = JSON.parse(configOutput.toString());
      const services = composeConfig.services || {};
      const dependencies: ServiceDependency[] = [];

      for (const [serviceName, serviceConfig] of Object.entries(services)) {
        const dependsOn = (serviceConfig as any).depends_on || [];
        const healthCheck = !!(serviceConfig as any).healthcheck;
        
        dependencies.push({
          service: serviceName,
          dependsOn: Array.isArray(dependsOn) ? dependsOn : Object.keys(dependsOn),
          healthCheck,
          startupTime: this.estimateStartupTime(serviceConfig as any),
        });
      }

      this.operationLogService.log('info', `Found ${dependencies.length} services with dependency analysis`);
      return dependencies;

    } catch (error) {
      this.operationLogService.log('info', `Dependency analysis failed: ${error}`);
      return [];
    }
  }

  private estimateStartupTime(serviceConfig: any): number {
    // Estimate startup time based on service configuration
    if (serviceConfig.healthcheck) {
      const interval = this.parseTimeString(serviceConfig.healthcheck.interval) || 30;
      const retries = serviceConfig.healthcheck.retries || 3;
      return interval * retries;
    }

    // Default estimates based on common service types
    const image = serviceConfig.image || '';
    if (image.includes('postgres') || image.includes('mysql') || image.includes('mariadb')) {
      return 30; // Database services typically take longer
    }
    if (image.includes('redis') || image.includes('memcached')) {
      return 10; // Cache services are usually quick
    }
    if (image.includes('nginx') || image.includes('apache')) {
      return 15; // Web servers
    }

    return 20; // Default estimate
  }

  private parseTimeString(timeStr: string): number {
    if (!timeStr) return 0;
    const match = timeStr.match(/(\d+)([smh]?)/);
    if (!match) return 0;
    
    const value = parseInt(match[1]);
    const unit = match[2] || 's';
    
    switch (unit) {
      case 'm': return value * 60;
      case 'h': return value * 3600;
      default: return value;
    }
  }

  private async preUpdateValidation(hostCred: any, container: any, options: ComposeUpdateOptions): Promise<void> {
    this.operationLogService.log('info', `Performing pre-update validation...`);

    // Check if compose project is accessible
    const { code: psCode } = await this.docker.execShell(
      hostCred,
      `cd "${container.composeWorkingDir}" && docker compose ps`,
      { timeout: 30 }
    );

    if (psCode !== 0) {
      throw new Error('Compose project is not accessible or working directory is invalid');
    }

    // Run pre-update script if provided
    if (options.preUpdateScript) {
      this.operationLogService.log('info', `Running pre-update script...`);
      const { code: scriptCode, stderr: scriptStderr } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && ${options.preUpdateScript}`
      );
      if (scriptCode !== 0) {
        throw new Error(`Pre-update script failed: ${scriptStderr}`);
      }
    }
  }

  private async pullComposeImages(hostCred: any, container: any, imageRef?: string): Promise<void> {
    this.operationLogService.log('info', `Pulling Compose images...`);

    if (imageRef && container.composeService) {
      // Pull specific image for the service
      this.operationLogService.log('info', `Pulling specific image: ${imageRef}`);
      const pullResult = await this.docker.pullImage(hostCred, imageRef);
      if (pullResult !== 0) {
        throw new Error(`Failed to pull image ${imageRef}`);
      }
    } else {
      // Pull all images for the project
      const { code: pullCode, stderr: pullStderr } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && docker compose pull`,
        { timeout: 600 }
      );

      if (pullCode !== 0) {
        throw new Error(`Failed to pull Compose images: ${pullStderr}`);
      }
    }
  }

  private async updateServiceByService(hostCred: any, container: any, options: ComposeUpdateOptions, result: ComposeUpdateResult): Promise<void> {
    this.operationLogService.log('info', `Updating service by service...`);

    const serviceName = container.composeService;
    if (!serviceName) {
      throw new Error('Service name not available for service-by-service update');
    }

    try {
      // Update the specific service
      const updateCommand = options.recreateContainers 
        ? `docker compose up -d --force-recreate --no-deps ${serviceName}`
        : `docker compose up -d --no-deps ${serviceName}`;

      const { code: updateCode, stderr: updateStderr } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && ${updateCommand}`,
        { timeout: 300 }
      );

      if (updateCode !== 0) {
        result.servicesFailed.push(serviceName);
        throw new Error(`Failed to update service ${serviceName}: ${updateStderr}`);
      }

      result.servicesUpdated.push(serviceName);
      this.operationLogService.log('info', `✅ Service ${serviceName} updated successfully`);

      // Wait for service to be healthy
      await this.waitForServiceHealth(hostCred, container, serviceName, options);

    } catch (error) {
      result.servicesFailed.push(serviceName);
      throw error;
    }
  }

  private async updateAllAtOnce(hostCred: any, container: any, options: ComposeUpdateOptions, result: ComposeUpdateResult): Promise<void> {
    this.operationLogService.log('info', `Updating all services at once...`);

    try {
      const updateCommand = options.recreateContainers 
        ? `docker compose up -d --force-recreate`
        : `docker compose up -d`;

      const { code: updateCode, stderr: updateStderr } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && ${updateCommand}`,
        { timeout: 600 }
      );

      if (updateCode !== 0) {
        throw new Error(`Failed to update Compose project: ${updateStderr}`);
      }

      // Get list of services that were updated
      const { code: psCode, stdout: psOutput } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && docker compose ps --services`,
        { timeout: 30 }
      );

      if (psCode === 0) {
        result.servicesUpdated = psOutput.toString().trim().split('\n').filter(Boolean);
      }

      this.operationLogService.log('info', `✅ All services updated successfully`);

    } catch (error) {
      throw error;
    }
  }

  private async updateByDependencyOrder(hostCred: any, container: any, dependencies: ServiceDependency[], options: ComposeUpdateOptions, result: ComposeUpdateResult): Promise<void> {
    this.operationLogService.log('info', `Updating services in dependency order...`);

    // Build dependency graph and determine update order
    const updateOrder = this.resolveDependencyOrder(dependencies);
    this.operationLogService.log('info', `Update order: ${updateOrder.join(' → ')}`);

    for (const serviceName of updateOrder) {
      try {
        this.operationLogService.log('info', `Updating service: ${serviceName}`);

        const updateCommand = options.recreateContainers 
          ? `docker compose up -d --force-recreate --no-deps ${serviceName}`
          : `docker compose up -d --no-deps ${serviceName}`;

        const { code: updateCode, stderr: updateStderr } = await this.docker.execShell(
          hostCred,
          `cd "${container.composeWorkingDir}" && ${updateCommand}`,
          { timeout: 300 }
        );

        if (updateCode !== 0) {
          result.servicesFailed.push(serviceName);
          throw new Error(`Failed to update service ${serviceName}: ${updateStderr}`);
        }

        result.servicesUpdated.push(serviceName);
        this.operationLogService.log('info', `✅ Service ${serviceName} updated successfully`);

        // Wait for service to be healthy before proceeding to next
        await this.waitForServiceHealth(hostCred, container, serviceName, options);

        // Wait for dependency stabilization
        const dependency = dependencies.find(d => d.service === serviceName);
        if (dependency && dependency.startupTime) {
          const waitTime = Math.min(dependency.startupTime, options.dependencyWaitTime || 30);
          this.operationLogService.log('info', `Waiting ${waitTime}s for service ${serviceName} to stabilize...`);
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
        }

      } catch (error) {
        result.servicesFailed.push(serviceName);
        if (options.rollbackOnFailure) {
          throw error; // Stop and trigger rollback
        } else {
          this.operationLogService.log('error', `Service ${serviceName} update failed, continuing with next service: ${error}`);
        }
      }
    }
  }

  private resolveDependencyOrder(dependencies: ServiceDependency[]): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (serviceName: string) => {
      if (visiting.has(serviceName)) {
        throw new Error(`Circular dependency detected involving service: ${serviceName}`);
      }
      if (visited.has(serviceName)) {
        return;
      }

      visiting.add(serviceName);
      
      const dependency = dependencies.find(d => d.service === serviceName);
      if (dependency) {
        for (const dep of dependency.dependsOn) {
          visit(dep);
        }
      }

      visiting.delete(serviceName);
      visited.add(serviceName);
      order.push(serviceName);
    };

    // Visit all services
    for (const dependency of dependencies) {
      if (!visited.has(dependency.service)) {
        visit(dependency.service);
      }
    }

    return order;
  }

  private async waitForServiceHealth(hostCred: any, container: any, serviceName: string, options: ComposeUpdateOptions): Promise<void> {
    const timeout = options.healthCheckTimeout || 60;
    this.operationLogService.log('info', `Waiting for service ${serviceName} to be healthy (timeout: ${timeout}s)...`);

    const startTime = Date.now();
    const maxWaitTime = timeout * 1000;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const { code: psCode, stdout: psOutput } = await this.docker.execShell(
          hostCred,
          `cd "${container.composeWorkingDir}" && docker compose ps ${serviceName} --format json`,
          { timeout: 30 }
        );

        if (psCode === 0 && psOutput.toString().trim()) {
          const serviceInfo = JSON.parse(psOutput.toString().trim());
          
          if (serviceInfo.State === 'running') {
            // Check health status if available
            if (serviceInfo.Health) {
              if (serviceInfo.Health === 'healthy') {
                this.operationLogService.log('info', `✅ Service ${serviceName} is healthy`);
                return;
              } else if (serviceInfo.Health === 'unhealthy') {
                throw new Error(`Service ${serviceName} is unhealthy`);
              }
              // If starting, continue waiting
            } else {
              // No health check defined, consider running as healthy
              this.operationLogService.log('info', `✅ Service ${serviceName} is running (no health check defined)`);
              return;
            }
          }
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        this.operationLogService.log('error', `Health check error for ${serviceName}: ${error}`);
      }
    }

    throw new Error(`Service ${serviceName} health check timed out after ${timeout}s`);
  }

  private async postUpdateValidation(hostCred: any, container: any, options: ComposeUpdateOptions): Promise<void> {
    this.operationLogService.log('info', `Performing post-update validation...`);

    // Run post-update script if provided
    if (options.postUpdateScript) {
      this.operationLogService.log('info', `Running post-update script...`);
      const { code: scriptCode, stderr: scriptStderr } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && ${options.postUpdateScript}`
      );
      if (scriptCode !== 0) {
        this.operationLogService.log('error', `Post-update script failed: ${scriptStderr}`);
      }
    }

    // Verify all services are running
    const { code: psCode, stdout: psOutput } = await this.docker.execShell(
      hostCred,
      `cd "${container.composeWorkingDir}" && docker compose ps --format json`,
      { timeout: 30 }
    );

    if (psCode === 0) {
      const services = psOutput.toString().trim().split('\n').filter(Boolean).map((line: string) => JSON.parse(line));
      const downServices = services.filter((service: any) => service.State !== 'running');
      
      if (downServices.length > 0) {
        this.operationLogService.log('error', `⚠️ Some services are not running: ${downServices.map(s => s.Service).join(', ')}`);
      } else {
        this.operationLogService.log('info', `✅ All services are running`);
      }
    }
  }

  private async performComposeRollback(container: any, options: ComposeUpdateOptions): Promise<boolean> {
    try {
      const hostCred = await this.getHostCredById(container.hostId);
      if (!hostCred) return false;

      this.operationLogService.log('info', `Performing Compose rollback...`);

      // Try to restart the services
      const { code: restartCode } = await this.docker.execShell(
        hostCred,
        `cd "${container.composeWorkingDir}" && docker compose restart`,
        { timeout: 300 }
      );

      if (restartCode === 0) {
        this.operationLogService.log('info', `✅ Compose rollback completed successfully`);
        return true;
      }

      this.operationLogService.log('error', `❌ Compose rollback failed`);
      return false;
    } catch (error) {
      this.operationLogService.log('error', `Rollback error: ${error}`);
      return false;
    }
  }

  private async getHostCredById(hostId: string) {
    const host = await this.prisma.host.findUnique({ where: { id: hostId } });
    if (!host) return null;

    return {
      id: host.id,
      address: host.address,
      sshUser: host.sshUser,
      port: host.port ?? undefined,
      password: host.sshPassword ? this.crypto.decryptString(host.sshPassword)?.toString() : undefined,
      privateKey: host.sshPrivateKey ? this.crypto.decryptString(host.sshPrivateKey)?.toString() : undefined,
      privateKeyPassphrase: host.sshPrivateKeyPassphrase ? this.crypto.decryptString(host.sshPrivateKeyPassphrase)?.toString() : undefined,
    };
  }
}
