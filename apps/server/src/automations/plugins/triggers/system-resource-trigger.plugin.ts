import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult, DynamicConfigOptions } from '../interfaces';
import { HostsService } from '../../../hosts/hosts.service';

interface SystemStats {
  cpu: {
    usage: number;
    load: number[];
  };
  memory: {
    usage: number;
    total: number;
    used: number;
    available: number;
  };
  disk: {
    usage: number;
    total: number;
    used: number;
    available: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
  };
}

/**
 * System resource trigger plugin
 * Triggers based on system resource usage thresholds (CPU, Memory, Disk, Network)
 */
@Injectable()
export class SystemResourceTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'system-resource-trigger';
  public readonly name = 'System Resource Trigger';
  public readonly description = 'Triggers based on system resource usage thresholds';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['system', 'monitoring', 'resources'];
  public readonly triggerType = 'system-resource';
  
  constructor(
    private readonly hostsService: HostsService
  ) {
    super();
  }
  
  /**
   * Evaluate system resource trigger
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    try {
      if (!this.isTriggerEnabled(config)) {
        return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
      }
      
      const hostId = this.getConfigValue(config, 'hostId', null);
      const resource = this.getConfigValue(config, 'resource', 'cpu');
      const threshold = this.getConfigValue(config, 'threshold', 80);
      const comparison = this.getConfigValue(config, 'comparison', 'greater_than');
      const duration = this.getConfigValue(config, 'duration', 0); // seconds to maintain threshold
      
      if (!hostId) {
        return this.createTriggerResult(false, { reason: 'Host ID is required' });
      }
      
      // Get system stats from host
      const stats = await this.getSystemStats(hostId);
      if (!stats) {
        return this.createTriggerResult(false, { reason: 'Failed to get system stats' });
      }
      
      const currentValue = this.getResourceValue(stats, resource);
      const shouldTrigger = this.evaluateThreshold(currentValue, threshold, comparison);
      
      // If duration is specified, check if threshold has been maintained
      if (shouldTrigger && duration > 0) {
        const sustainedTrigger = await this.checkSustainedThreshold(hostId, resource, threshold, comparison, duration);
        if (!sustainedTrigger) {
          return this.createTriggerResult(false, { 
            reason: `Threshold not sustained for ${duration} seconds` 
          });
        }
      }
      
      return this.createTriggerResult(shouldTrigger, {
        reason: shouldTrigger 
          ? `${resource} ${comparison} ${threshold}% (current: ${currentValue.toFixed(2)}%)` 
          : `${resource} threshold not met (current: ${currentValue.toFixed(2)}%)`,
        triggerData: {
          hostId,
          resource,
          threshold,
          currentValue,
          stats: stats,
          evaluationTime: context.timestamp
        }
      });
      
    } catch (error) {
      this.logError('Error evaluating system resource trigger', error);
      return this.createTriggerResult(false, { 
        reason: `System resource evaluation error: ${error.message}` 
      });
    }
  }
  
  /**
   * Get trigger configuration schema
   */
  public getTriggerConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        hostId: {
          type: 'string',
          title: 'Target Host',
          description: 'Host to monitor system resources on',
          placeholder: 'Select a host to monitor'
        },
        resource: {
          type: 'string',
          title: 'Resource Type',
          description: 'System resource to monitor for threshold violations',
          enum: ['cpu', 'memory', 'disk', 'network_in', 'network_out', 'load_average'],
          default: 'cpu',
          examples: ['cpu', 'memory', 'disk']
        },
        threshold: {
          type: 'number',
          title: 'Threshold (%)',
          description: 'Resource usage threshold percentage (0-100%)',
          minimum: 0,
          maximum: 100,
          default: 80,
          examples: [70, 80, 90, 95]
        },
        comparison: {
          type: 'string',
          title: 'Comparison Operator',
          description: 'How to compare current usage with threshold',
          enum: ['greater_than', 'less_than', 'equal_to'],
          default: 'greater_than',
          examples: ['greater_than', 'less_than']
        },
        duration: {
          type: 'number',
          title: 'Sustained Duration (seconds)',
          description: 'How long threshold must be exceeded before triggering (0 = immediate)',
          minimum: 0,
          maximum: 3600,
          default: 60,
          examples: [0, 30, 60, 300]
        },
        checkInterval: {
          type: 'number',
          title: 'Check Interval (seconds)',
          description: 'How frequently to check resource usage',
          minimum: 30,
          maximum: 3600,
          default: 60,
          examples: [30, 60, 120, 300]
        },
        alertSeverity: {
          type: 'string',
          title: 'Alert Severity',
          description: 'Severity level for this resource alert',
          enum: ['low', 'medium', 'high', 'critical'],
          default: 'medium',
          examples: ['medium', 'high', 'critical']
        }
      },
      required: ['hostId', 'resource', 'threshold'],
      additionalProperties: false
    };
  }
  
  /**
   * Get dynamic configuration options for trigger fields
   */
  public async getTriggerDynamicOptions(): Promise<DynamicConfigOptions> {
    try {
      const options: DynamicConfigOptions = {};

      // Get available hosts
      const { items: hosts } = await this.hostsService.list();
      options.hostId = hosts.map((host: any) => ({
        value: host.id,
        label: `${host.name} (${host.address})`,
        description: `Host: ${host.address}`,
        group: 'Hosts'
      }));

      return options;
    } catch (error) {
      this.logError('Failed to get dynamic options', error);
      return {};
    }
  }

  /**
   * Get next evaluation time based on check interval
   */
  public async getNextEvaluationTime(config: TriggerConfig): Promise<Date | null> {
    const checkInterval = this.getConfigValue(config, 'checkInterval', 60);
    return new Date(Date.now() + (checkInterval * 1000));
  }
  
  /**
   * Validate system resource trigger configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    if (!this.validateRequiredFields(config, ['hostId', 'resource', 'threshold'])) {
      return false;
    }
    
    const resource = config.config.resource;
    const validResources = ['cpu', 'memory', 'disk', 'network_in', 'network_out'];
    if (!validResources.includes(resource)) {
      this.logError(`Invalid resource type: ${resource}`);
      return false;
    }
    
    const threshold = config.config.threshold;
    if (threshold < 0 || threshold > 100) {
      this.logError('Threshold must be between 0 and 100');
      return false;
    }
    
    return true;
  }
  
  /**
   * Get system stats from host
   */
  private async getSystemStats(hostId: string): Promise<SystemStats | null> {
    try {
      // This would integrate with your existing host monitoring
      // For now, return mock data - you'll need to implement actual system stats collection
      
      // In a real implementation, this would execute commands like:
      // - CPU: `top -bn1 | grep "Cpu(s)" | awk '{print $2}' | sed 's/%us,//'`
      // - Memory: `free -m | grep "Mem:" | awk '{print ($3/$2) * 100}'`
      // - Disk: `df -h / | tail -1 | awk '{print $5}' | sed 's/%//'`
      
      return {
        cpu: {
          usage: Math.random() * 100,
          load: [1.2, 1.5, 1.8]
        },
        memory: {
          usage: Math.random() * 100,
          total: 8192,
          used: 4096,
          available: 4096
        },
        disk: {
          usage: Math.random() * 100,
          total: 100000,
          used: 50000,
          available: 50000
        },
        network: {
          bytesIn: Math.random() * 1000000,
          bytesOut: Math.random() * 1000000
        }
      };
    } catch (error) {
      this.logError('Failed to get system stats', error);
      return null;
    }
  }
  
  /**
   * Get resource value from stats
   */
  private getResourceValue(stats: SystemStats, resource: string): number {
    switch (resource) {
      case 'cpu':
        return stats.cpu.usage;
      case 'memory':
        return stats.memory.usage;
      case 'disk':
        return stats.disk.usage;
      case 'network_in':
        return (stats.network.bytesIn / 1024 / 1024); // MB/s
      case 'network_out':
        return (stats.network.bytesOut / 1024 / 1024); // MB/s
      default:
        return 0;
    }
  }
  
  /**
   * Evaluate threshold condition
   */
  private evaluateThreshold(currentValue: number, threshold: number, comparison: string): boolean {
    switch (comparison) {
      case 'greater_than':
        return currentValue > threshold;
      case 'less_than':
        return currentValue < threshold;
      case 'equal_to':
        return Math.abs(currentValue - threshold) < 0.01;
      default:
        return false;
    }
  }
  
  /**
   * Check if threshold has been sustained for specified duration
   */
  private async checkSustainedThreshold(
    hostId: string, 
    resource: string, 
    threshold: number, 
    comparison: string, 
    duration: number
  ): Promise<boolean> {
    // This would check historical data to see if threshold has been maintained
    // For now, return true - implement based on your monitoring data storage
    return true;
  }
}