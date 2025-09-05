import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DockerService } from './docker.service';
import { CryptoService } from '../security/crypto.service';
import { OperationLogService } from '../operation-log/operation-log.service';

export interface CliUpdateOptions {
  preserveVolumes?: boolean;
  createVolumeSnapshot?: boolean;
  healthCheckTimeout?: number;
  rollbackOnHealthFailure?: boolean;
  backupStrategy?: 'rename' | 'export' | 'snapshot';
  maxRollbackAttempts?: number;
  preUpdateScript?: string;
  postUpdateScript?: string;
}

export interface CliUpdateResult {
  success: boolean;
  backupCreated: boolean;
  backupId?: string;
  volumesPreserved: boolean;
  healthCheckPassed: boolean;
  rollbackPerformed: boolean;
  duration: number;
  error?: string;
}

@Injectable()
export class ContainerCliUpdateService {
  private readonly logger = new Logger(ContainerCliUpdateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docker: DockerService,
    private readonly crypto: CryptoService,
    private readonly operationLogService: OperationLogService,
  ) {}

  async updateCliContainer(
    container: any,
    imageRef?: string,
    options: CliUpdateOptions = {},
  ): Promise<CliUpdateResult> {
    const startTime = Date.now();
    const result: CliUpdateResult = {
      success: false,
      backupCreated: false,
      volumesPreserved: false,
      healthCheckPassed: false,
      rollbackPerformed: false,
      duration: 0,
    };

    try {
      const hostCred = await this.getHostCredById(container.hostId);
      if (!hostCred) throw new Error(`Host with id ${container.hostId} not found`);

      const targetImageRef = imageRef || `${container.imageName}:${container.imageTag}`;
      
      this.operationLogService.log('info', `Starting enhanced CLI container update for "${container.name}" with image: ${targetImageRef}`);

      // Step 1: Pre-update validation and preparation
      await this.preUpdateValidation(hostCred, container, options);

      // Step 2: Create comprehensive backup
      const backupInfo = await this.createAdvancedBackup(hostCred, container, options);
      result.backupCreated = backupInfo.success;
      result.backupId = backupInfo.backupId;

      // Step 3: Preserve volumes if requested
      if (options.preserveVolumes) {
        result.volumesPreserved = await this.preserveVolumes(hostCred, container, options);
      }

      // Step 4: Pull new image
      await this.pullNewImage(hostCred, targetImageRef);

      // Step 5: Stop current container gracefully
      await this.stopContainerGracefully(hostCred, container);

      // Step 6: Create and start new container
      await this.createAndStartNewContainer(hostCred, container, targetImageRef, options);

      // Step 7: Perform health checks
      result.healthCheckPassed = await this.performHealthChecks(hostCred, container, options);

      if (!result.healthCheckPassed && options.rollbackOnHealthFailure) {
        throw new Error('Health check failed, triggering rollback');
      }

      // Step 8: Post-update cleanup
      await this.postUpdateCleanup(hostCred, container, backupInfo, options);

      result.success = true;
      result.duration = Date.now() - startTime;
      
      this.operationLogService.log('info', `✅ Enhanced CLI container update completed successfully in ${Math.round(result.duration / 1000)}s`);
      
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.operationLogService.log('error', `❌ CLI container update failed: ${errorMessage}`);
      
      // Attempt rollback
      try {
        result.rollbackPerformed = await this.performAdvancedRollback(container, result.backupId, options);
        this.operationLogService.log('info', `Rollback ${result.rollbackPerformed ? 'completed' : 'failed'}`);
      } catch (rollbackError) {
        this.operationLogService.log('error', `Rollback failed: ${rollbackError}`);
      }

      result.success = false;
      result.duration = Date.now() - startTime;
      result.error = errorMessage;
      
      return result;
    }
  }

  private async preUpdateValidation(hostCred: any, container: any, options: CliUpdateOptions): Promise<void> {
    this.operationLogService.log('info', `Performing pre-update validation...`);

    // Check if container exists and is accessible
    const { code: inspectCode } = await this.docker.exec(hostCred, ['inspect', container.containerId], 30);
    if (inspectCode !== 0) {
      throw new Error('Container not found or not accessible');
    }

    // Check available disk space
    const { code: dfCode, stdout: dfOutput } = await this.docker.exec(hostCred, ['system', 'df'], 30);
    if (dfCode === 0) {
      const lines = dfOutput.split('\n');
      const dataLine = lines.find(line => line.includes('Local Volumes'));
      if (dataLine) {
        const availableSpace = dataLine.match(/(\d+(?:\.\d+)?[KMGT]?B)\s+\((\d+)%\)/);
        if (availableSpace && parseInt(availableSpace[2]) > 90) {
          this.operationLogService.log('info', `⚠️ Warning: Low disk space (${availableSpace[2]}% used)`);
        }
      }
    }

    // Run pre-update script if provided
    if (options.preUpdateScript) {
      this.operationLogService.log('info', `Running pre-update script...`);
      const { code: scriptCode, stderr: scriptStderr } = await this.docker.execShell(hostCred, options.preUpdateScript);
      if (scriptCode !== 0) {
        throw new Error(`Pre-update script failed: ${scriptStderr}`);
      }
    }
  }

  private async createAdvancedBackup(hostCred: any, container: any, options: CliUpdateOptions): Promise<{
    success: boolean;
    backupId?: string;
    backupType: string;
  }> {
    const backupStrategy = options.backupStrategy || 'rename';
    const timestamp = Date.now();
    const backupId = `${container.name}_backup_${timestamp}`;

    this.operationLogService.log('info', `Creating ${backupStrategy} backup: ${backupId}`);

    switch (backupStrategy) {
      case 'export':
        return this.createExportBackup(hostCred, container, backupId);
      case 'snapshot':
        return this.createSnapshotBackup(hostCred, container, backupId);
      case 'rename':
      default:
        return this.createRenameBackup(hostCred, container, backupId);
    }
  }

  private async createRenameBackup(hostCred: any, container: any, backupId: string): Promise<{
    success: boolean;
    backupId: string;
    backupType: string;
  }> {
    const { code: renameCode } = await this.docker.exec(hostCred, ['rename', container.containerId, backupId], 60);
    
    if (renameCode !== 0) {
      throw new Error(`Failed to create rename backup`);
    }

    return {
      success: true,
      backupId,
      backupType: 'rename',
    };
  }

  private async createExportBackup(hostCred: any, container: any, backupId: string): Promise<{
    success: boolean;
    backupId: string;
    backupType: string;
  }> {
    // Export container to tar file
    const exportPath = `/tmp/${backupId}.tar`;
    const { code: exportCode } = await this.docker.exec(
      hostCred, 
      ['export', container.containerId, '-o', exportPath], 
      300
    );
    
    if (exportCode !== 0) {
      throw new Error(`Failed to create export backup`);
    }

    this.operationLogService.log('info', `Container exported to ${exportPath}`);

    return {
      success: true,
      backupId: exportPath,
      backupType: 'export',
    };
  }

  private async createSnapshotBackup(hostCred: any, container: any, backupId: string): Promise<{
    success: boolean;
    backupId: string;
    backupType: string;
  }> {
    // Create a snapshot by committing the container to a new image
    const snapshotImage = `${container.imageName}_snapshot:${backupId}`;
    const { code: commitCode } = await this.docker.exec(
      hostCred,
      ['commit', container.containerId, snapshotImage],
      120
    );

    if (commitCode !== 0) {
      throw new Error(`Failed to create snapshot backup`);
    }

    this.operationLogService.log('info', `Container snapshot created: ${snapshotImage}`);

    return {
      success: true,
      backupId: snapshotImage,
      backupType: 'snapshot',
    };
  }

  private async preserveVolumes(hostCred: any, container: any, options: CliUpdateOptions): Promise<boolean> {
    try {
      this.operationLogService.log('info', `Preserving volumes for container ${container.name}...`);

      // Get container volume information
      const { code: inspectCode, stdout: inspectOutput } = await this.docker.exec(
        hostCred,
        ['inspect', container.containerId],
        30
      );

      if (inspectCode !== 0) {
        return false;
      }

      const containerInfo = JSON.parse(inspectOutput)[0];
      const mounts = containerInfo.Mounts || [];
      
      if (mounts.length === 0) {
        this.operationLogService.log('info', `No volumes to preserve`);
        return true;
      }

      // Create volume snapshots if requested
      if (options.createVolumeSnapshot) {
        for (const mount of mounts) {
          if (mount.Type === 'volume') {
            const snapshotName = `${mount.Name}_snapshot_${Date.now()}`;
            this.operationLogService.log('info', `Creating volume snapshot: ${snapshotName}`);
            
            // Create a temporary container to copy volume data
            const { code: createCode } = await this.docker.exec(
              hostCred,
              ['volume', 'create', snapshotName],
              60
            );

            if (createCode === 0) {
              // Copy data using a temporary container
              await this.docker.exec(
                hostCred,
                ['run', '--rm', '-v', `${mount.Name}:/source:ro`, '-v', `${snapshotName}:/dest`, 'alpine', 'cp', '-a', '/source/.', '/dest/'],
                300
              );
            }
          }
        }
      }

      return true;
    } catch (error) {
      this.operationLogService.log('error', `Failed to preserve volumes: ${error}`);
      return false;
    }
  }

  private async pullNewImage(hostCred: any, imageRef: string): Promise<void> {
    this.operationLogService.log('info', `Pulling new image: ${imageRef}`);
    const pullResult = await this.docker.pullImage(hostCred, imageRef);
    if (pullResult !== 0) {
      throw new Error(`Failed to pull image ${imageRef}`);
    }
  }

  private async stopContainerGracefully(hostCred: any, container: any): Promise<void> {
    this.operationLogService.log('info', `Stopping container gracefully...`);
    
    // Try graceful stop first
    const { code: stopCode } = await this.docker.exec(hostCred, ['stop', '-t', '30', container.containerId], 45);
    
    if (stopCode !== 0) {
      this.operationLogService.log('info', `Graceful stop failed, forcing stop...`);
      await this.docker.exec(hostCred, ['kill', container.containerId], 30);
    }
  }

  private async createAndStartNewContainer(hostCred: any, container: any, imageRef: string, options: CliUpdateOptions): Promise<void> {
    if (!container.runCommand) {
      throw new Error(`No run command available for container ${container.name}`);
    }

    // Replace the image in the run command
    const updatedRunCommand = this.updateImageInRunCommand(container.runCommand, imageRef);
    
    this.operationLogService.log('info', `Creating new container with updated image...`);
    const { code: createCode, stderr: createStderr } = await this.docker.execShell(hostCred, updatedRunCommand, { timeout: 300 });
    
    if (createCode !== 0) {
      throw new Error(`Failed to create new container: ${createStderr}`);
    }

    // Start the new container
    this.operationLogService.log('info', `Starting new container...`);
    const { code: startCode, stderr: startStderr } = await this.docker.exec(hostCred, ['start', container.name], 120);
    
    if (startCode !== 0) {
      throw new Error(`Failed to start new container: ${startStderr}`);
    }
  }

  private async performHealthChecks(hostCred: any, container: any, options: CliUpdateOptions): Promise<boolean> {
    const timeout = options.healthCheckTimeout || 60;
    this.operationLogService.log('info', `Performing health checks (timeout: ${timeout}s)...`);

    // Wait a bit for container to initialize
    await new Promise(resolve => setTimeout(resolve, 5000));

    const startTime = Date.now();
    const maxWaitTime = timeout * 1000;

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Check if container is running
        const { code: psCode, stdout: psStdout } = await this.docker.exec(
          hostCred,
          ['ps', '--filter', `name=${container.name}`, '--format', 'json'],
          30
        );

        if (psCode === 0 && psStdout.trim()) {
          const containerInfo = JSON.parse(psStdout.trim());
          
          if (containerInfo.State === 'running') {
            // Check health status if available
            const { code: inspectCode, stdout: inspectOutput } = await this.docker.exec(
              hostCred,
              ['inspect', container.name],
              30
            );

            if (inspectCode === 0) {
              const inspectData = JSON.parse(inspectOutput)[0];
              const healthStatus = inspectData?.State?.Health?.Status;
              
              if (healthStatus) {
                if (healthStatus === 'healthy') {
                  this.operationLogService.log('info', `✅ Health check passed: container is healthy`);
                  return true;
                } else if (healthStatus === 'unhealthy') {
                  this.operationLogService.log('error', `❌ Health check failed: container is unhealthy`);
                  return false;
                }
                // If starting, continue waiting
              } else {
                // No health check defined, consider running as healthy
                this.operationLogService.log('info', `✅ Health check passed: container is running (no health check defined)`);
                return true;
              }
            }
          }
        }

        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        this.operationLogService.log('error', `Health check error: ${error}`);
      }
    }

    this.operationLogService.log('error', `❌ Health check timed out after ${timeout}s`);
    return false;
  }

  private async postUpdateCleanup(hostCred: any, container: any, backupInfo: any, options: CliUpdateOptions): Promise<void> {
    this.operationLogService.log('info', `Performing post-update cleanup...`);

    // Run post-update script if provided
    if (options.postUpdateScript) {
      this.operationLogService.log('info', `Running post-update script...`);
      const { code: scriptCode, stderr: scriptStderr } = await this.docker.execShell(hostCred, options.postUpdateScript);
      if (scriptCode !== 0) {
        this.operationLogService.log('error', `Post-update script failed: ${scriptStderr}`);
      }
    }

    // Clean up backup based on strategy
    if (backupInfo.success) {
      switch (backupInfo.backupType) {
        case 'rename':
          this.operationLogService.log('info', `Removing backup container: ${backupInfo.backupId}`);
          await this.docker.exec(hostCred, ['rm', backupInfo.backupId], 60);
          break;
        case 'export':
          this.operationLogService.log('info', `Backup file preserved at: ${backupInfo.backupId}`);
          // Keep export file for manual cleanup
          break;
        case 'snapshot':
          this.operationLogService.log('info', `Backup image preserved: ${backupInfo.backupId}`);
          // Keep snapshot image for manual cleanup
          break;
      }
    }
  }

  private async performAdvancedRollback(container: any, backupId?: string, options: CliUpdateOptions = {}): Promise<boolean> {
    if (!backupId) {
      this.operationLogService.log('error', `No backup available for rollback`);
      return false;
    }

    try {
      const hostCred = await this.getHostCredById(container.hostId);
      if (!hostCred) return false;

      this.operationLogService.log('info', `Performing advanced rollback using backup: ${backupId}`);

      // Remove failed new container if it exists
      await this.docker.exec(hostCred, ['rm', '-f', container.name], 60);

      // Restore from backup
      const { code: restoreCode } = await this.docker.exec(hostCred, ['rename', backupId, container.name], 60);
      
      if (restoreCode === 0) {
        // Start the restored container
        const { code: startCode } = await this.docker.exec(hostCred, ['start', container.name], 120);
        
        if (startCode === 0) {
          this.operationLogService.log('info', `✅ Rollback completed successfully`);
          return true;
        }
      }

      this.operationLogService.log('error', `❌ Rollback failed`);
      return false;
    } catch (error) {
      this.operationLogService.log('error', `Rollback error: ${error}`);
      return false;
    }
  }

  private updateImageInRunCommand(runCommand: string, newImageRef: string): string {
    // Simple regex to replace the image reference in the run command
    const imageRegex = /(\s+)([^\s]+)(\s*$|\s+[^-])/;
    return runCommand.replace(imageRegex, `$1${newImageRef}$3`);
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
