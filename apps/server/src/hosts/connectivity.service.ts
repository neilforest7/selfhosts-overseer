import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ActivityLogService, ActivityCategory } from '../activity-log/activity-log.service';
import { HostStatus } from '@prisma/client';
import { spawn } from 'child_process';

export interface ConnectivityCheckResult {
  hostId: string;
  status: HostStatus;
  responseTime?: number;
  errorMessage?: string;
  checkedAt: Date;
}

export interface HostConnectivityEvent {
  hostId: string;
  hostName: string;
  previousStatus: HostStatus;
  currentStatus: HostStatus;
  responseTime?: number;
  errorMessage?: string;
  timestamp: Date;
}

@Injectable()
export class ConnectivityService {
  private readonly logger = new Logger(ConnectivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Check connectivity for a single host
   */
  async checkHostConnectivity(hostId: string): Promise<ConnectivityCheckResult> {
    const startTime = Date.now();
    
    try {
      // Get host details
      const host = await this.prisma.host.findUnique({
        where: { id: hostId },
      });

      if (!host) {
        throw new Error(`Host not found: ${hostId}`);
      }

      this.logger.debug(`Checking connectivity for host: ${host.name} (${host.address})`);

      // Perform SSH connectivity test
      const connectivityResult = await this.performSSHConnectivityTest(host);
      const responseTime = Date.now() - startTime;

      const result: ConnectivityCheckResult = {
        hostId,
        status: connectivityResult.success ? HostStatus.ONLINE : HostStatus.OFFLINE,
        responseTime: connectivityResult.success ? responseTime : undefined,
        errorMessage: connectivityResult.error,
        checkedAt: new Date(),
      };

      // Store the check result
      await this.storeConnectivityCheck(result);

      // Update host status and emit events if status changed
      await this.updateHostStatusAndEmitEvents(host, result);

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      this.logger.error(`Connectivity check failed for host ${hostId}: ${errorMessage}`);

      const result: ConnectivityCheckResult = {
        hostId,
        status: HostStatus.OFFLINE,
        responseTime,
        errorMessage,
        checkedAt: new Date(),
      };

      // Store the failed check result
      await this.storeConnectivityCheck(result);

      return result;
    }
  }

  /**
   * Check connectivity for all hosts
   */
  async checkAllHostsConnectivity(): Promise<ConnectivityCheckResult[]> {
    const hosts = await this.prisma.host.findMany({
      select: { id: true, name: true },
    });

    this.logger.log(`Starting connectivity check for ${hosts.length} hosts`);

    // Check hosts in parallel with controlled concurrency
    const concurrency = 10; // Maximum concurrent checks
    const results: ConnectivityCheckResult[] = [];

    for (let i = 0; i < hosts.length; i += concurrency) {
      const batch = hosts.slice(i, i + concurrency);
      const batchPromises = batch.map(host => 
        this.checkHostConnectivity(host.id).catch(error => {
          this.logger.error(`Failed to check connectivity for host ${host.name}: ${error.message}`);
          return {
            hostId: host.id,
            status: HostStatus.OFFLINE,
            errorMessage: error.message,
            checkedAt: new Date(),
          } as ConnectivityCheckResult;
        })
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    this.logger.log(`Completed connectivity check for ${hosts.length} hosts. Online: ${results.filter(r => r.status === HostStatus.ONLINE).length}, Offline: ${results.filter(r => r.status === HostStatus.OFFLINE).length}`);

    return results;
  }

  /**
   * Get connectivity history for a host
   */
  async getHostConnectivityHistory(hostId: string, limit = 100): Promise<any[]> {
    return this.prisma.hostConnectivityCheck.findMany({
      where: { hostId },
      orderBy: { checkedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get connectivity statistics for all hosts
   */
  async getConnectivityStats(): Promise<{
    total: number;
    online: number;
    offline: number;
    unknown: number;
    averageResponseTime: number;
  }> {
    const hosts = await this.prisma.host.findMany({
      select: { status: true },
    });

    const total = hosts.length;
    const online = hosts.filter(h => h.status === HostStatus.ONLINE).length;
    const offline = hosts.filter(h => h.status === HostStatus.OFFLINE).length;
    const unknown = hosts.filter(h => h.status === HostStatus.UNKNOWN).length;

    // Get average response time from recent checks
    const recentChecks = await this.prisma.hostConnectivityCheck.findMany({
      where: {
        status: HostStatus.ONLINE,
        responseTime: { not: null },
        checkedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
      select: { responseTime: true },
    });

    const averageResponseTime = recentChecks.length > 0
      ? recentChecks.reduce((sum, check) => sum + (check.responseTime || 0), 0) / recentChecks.length
      : 0;

    return {
      total,
      online,
      offline,
      unknown,
      averageResponseTime: Math.round(averageResponseTime),
    };
  }

  /**
   * Perform SSH connectivity test
   */
  private async performSSHConnectivityTest(host: any): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const timeout = 10000; // 10 seconds timeout
      const port = host.port || 22;
      
      // Use SSH connection test with timeout
      const sshArgs = [
        '-o', 'ConnectTimeout=10',
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'LogLevel=ERROR',
        '-p', port.toString(),
        `${host.sshUser}@${host.address}`,
        'echo "connectivity_test"'
      ];

      const sshProcess = spawn('ssh', sshArgs);
      let output = '';
      let errorOutput = '';

      const timer = setTimeout(() => {
        sshProcess.kill('SIGTERM');
        resolve({ success: false, error: 'Connection timeout' });
      }, timeout);

      sshProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      sshProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      sshProcess.on('close', (code) => {
        clearTimeout(timer);
        
        if (code === 0 && output.includes('connectivity_test')) {
          resolve({ success: true });
        } else {
          const error = errorOutput || `SSH connection failed with exit code ${code}`;
          resolve({ success: false, error: error.trim() });
        }
      });

      sshProcess.on('error', (error) => {
        clearTimeout(timer);
        resolve({ success: false, error: error.message });
      });
    });
  }

  /**
   * Store connectivity check result
   */
  private async storeConnectivityCheck(result: ConnectivityCheckResult): Promise<void> {
    try {
      await this.prisma.hostConnectivityCheck.create({
        data: {
          hostId: result.hostId,
          status: result.status,
          responseTime: result.responseTime,
          errorMessage: result.errorMessage,
          checkedAt: result.checkedAt,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to store connectivity check result: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update host status and emit events if status changed
   */
  private async updateHostStatusAndEmitEvents(host: any, result: ConnectivityCheckResult): Promise<void> {
    const previousStatus = host.status;
    const currentStatus = result.status;

    // Update host status and timestamps
    const updateData: any = {
      status: currentStatus,
      lastConnectivityCheck: result.checkedAt,
    };

    if (currentStatus === HostStatus.ONLINE && previousStatus !== HostStatus.ONLINE) {
      updateData.lastOnlineAt = result.checkedAt;
    } else if (currentStatus === HostStatus.OFFLINE && previousStatus !== HostStatus.OFFLINE) {
      updateData.lastOfflineAt = result.checkedAt;
    }

    await this.prisma.host.update({
      where: { id: host.id },
      data: updateData,
    });

    // Emit events and log activities only if status changed
    if (previousStatus !== currentStatus) {
      const event: HostConnectivityEvent = {
        hostId: host.id,
        hostName: host.name,
        previousStatus,
        currentStatus,
        responseTime: result.responseTime,
        errorMessage: result.errorMessage,
        timestamp: result.checkedAt,
      };

      // Emit system event for automation rules
      this.eventEmitter.emit(`host.${currentStatus.toLowerCase()}`, event);
      this.eventEmitter.emit('host.status.changed', event);

      // Log activity
      await this.logConnectivityActivity(host, previousStatus, currentStatus, result);

      this.logger.log(`Host ${host.name} status changed: ${previousStatus} → ${currentStatus}`);
    }
  }

  /**
   * Log connectivity activity
   */
  private async logConnectivityActivity(
    host: any,
    previousStatus: HostStatus,
    currentStatus: HostStatus,
    result: ConnectivityCheckResult
  ): Promise<void> {
    const action = currentStatus === HostStatus.ONLINE ? 'host_online' : 'host_offline';
    const title = `Host ${currentStatus === HostStatus.ONLINE ? 'came online' : 'went offline'}: ${host.name}`;
    const description = currentStatus === HostStatus.ONLINE
      ? `Host ${host.name} (${host.address}) is now reachable. Response time: ${result.responseTime}ms`
      : `Host ${host.name} (${host.address}) is no longer reachable. ${result.errorMessage || 'Connection failed'}`;

    await this.activityLog.create({
      category: ActivityCategory.HOST_MANAGEMENT,
      action,
      resourceType: 'host',
      resourceId: host.id,
      resourceName: host.name,
      hostId: host.id,
      hostName: host.name,
      title,
      description,
      metadata: {
        previousStatus,
        currentStatus,
        responseTime: result.responseTime,
        errorMessage: result.errorMessage,
        address: host.address,
        port: host.port || 22,
      },
      oldValues: { status: previousStatus },
      newValues: { status: currentStatus },
    });
  }
}
