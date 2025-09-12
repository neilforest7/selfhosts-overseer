import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult, DynamicConfigOptions } from '../interfaces';
import { SshService } from '../../../ssh/ssh.service';
import { HostsService } from '../../../hosts/hosts.service';
import * as path from 'path';

interface FileSystemEvent {
  type: 'created' | 'modified' | 'deleted' | 'moved';
  path: string;
  timestamp: Date;
  size?: number;
  permissions?: string;
}

/**
 * File system event trigger plugin
 * Triggers based on file system changes (file/directory created, modified, deleted)
 */
@Injectable()
export class FileSystemTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'filesystem-trigger';
  public readonly name = 'File System Trigger';
  public readonly description = 'Triggers based on file system changes';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['filesystem', 'files', 'monitoring', 'inotify'];
  public readonly triggerType = 'filesystem';
  
  constructor(
    private readonly sshService: SshService,
    private readonly hostsService: HostsService
  ) {
    super();
  }
  
  /**
   * Evaluate file system trigger
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    try {
      if (!this.isTriggerEnabled(config)) {
        return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
      }
      
      const hostId = this.getConfigValue(config, 'hostId', null);
      const watchPath = this.getConfigValue(config, 'watchPath', '');
      const eventType = this.getConfigValue(config, 'eventType', 'any');
      const filePattern = this.getConfigValue(config, 'filePattern', '*');
      const recursive = this.getConfigValue(config, 'recursive', false);
      
      if (!hostId || !watchPath) {
        return this.createTriggerResult(false, { 
          reason: 'Both hostId and watchPath are required' 
        });
      }
      
      // Check if path exists and get recent changes
      const events = await this.getRecentFileSystemEvents(hostId, watchPath, eventType, filePattern, recursive);
      
      if (events.length === 0) {
        return this.createTriggerResult(false, { reason: 'No recent file system events' });
      }
      
      // Filter events based on configuration
      const relevantEvents = this.filterEvents(events, config);
      const shouldTrigger = relevantEvents.length > 0;
      
      return this.createTriggerResult(shouldTrigger, {
        reason: shouldTrigger 
          ? `Found ${relevantEvents.length} file system events in ${watchPath}` 
          : 'No relevant file system events found',
        triggerData: {
          hostId,
          watchPath,
          eventType,
          filePattern,
          events: relevantEvents,
          totalEventsFound: events.length
        }
      });
      
    } catch (error) {
      this.logError('Error evaluating file system trigger', error);
      return this.createTriggerResult(false, { 
        reason: `File system evaluation error: ${error instanceof Error ? error.message : String(error)}` 
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
          description: 'Host to monitor file system changes on',
          placeholder: 'Select a host to monitor'
        },
        watchPath: {
          type: 'string',
          title: 'Watch Path',
          description: 'Directory or file path to monitor for changes',
          minLength: 1,
          placeholder: '/var/log',
          examples: [
            '/var/log',
            '/home/user/uploads',
            '/etc/nginx',
            '/opt/app/data',
            '/tmp/uploads'
          ]
        },
        eventType: {
          type: 'string',
          title: 'Event Type',
          description: 'Type of file system event to monitor',
          enum: ['any', 'created', 'modified', 'deleted', 'moved', 'accessed'],
          default: 'any',
          examples: ['created', 'modified', 'deleted']
        },
        filePattern: {
          type: 'string',
          title: 'File Pattern',
          description: 'File pattern to match using glob syntax (* = any, ? = single char)',
          default: '*',
          placeholder: '*.log',
          examples: [
            '*.log',
            '*.conf',
            '*.json',
            'error*',
            '*.{txt,log}',
            'backup-*.sql'
          ]
        },
        recursive: {
          type: 'boolean',
          title: 'Recursive Monitoring',
          description: 'Monitor subdirectories and their contents recursively',
          default: false
        },
        excludePatterns: {
          type: 'array',
          title: 'Exclude Patterns',
          description: 'File patterns to exclude from monitoring',
          items: {
            type: 'string',
            title: 'Exclude Pattern',
            placeholder: '*.tmp'
          },
          default: [],
          examples: [
            ['*.tmp', '*.swp'],
            ['node_modules/*', '.git/*'],
            ['*.bak', '*.old']
          ]
        },
        minFileSize: {
          type: 'number',
          title: 'Minimum File Size (bytes)',
          description: 'Only trigger for files larger than this size',
          minimum: 0,
          default: 0
        },
        maxFileAge: {
          type: 'number',
          title: 'Maximum File Age (seconds)',
          description: 'Only consider files modified within this time',
          minimum: 1,
          maximum: 86400,
          default: 300
        },
        checkInterval: {
          type: 'number',
          title: 'Check Interval (seconds)',
          description: 'How often to check for file system changes',
          minimum: 10,
          maximum: 3600,
          default: 60
        }
      },
      required: ['hostId', 'watchPath'],
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
   * Validate file system trigger configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    if (!this.validateRequiredFields(config, ['hostId', 'watchPath'])) {
      return false;
    }
    
    const eventType = config.config.eventType;
    const validEventTypes = ['any', 'created', 'modified', 'deleted', 'moved'];
    if (eventType && !validEventTypes.includes(eventType)) {
      this.logError(`Invalid event type: ${eventType}`);
      return false;
    }
    
    const watchPath = config.config.watchPath;
    if (!path.isAbsolute(watchPath)) {
      this.logError('Watch path must be an absolute path');
      return false;
    }
    
    return true;
  }
  
  /**
   * Get available trigger conditions
   */
  public getAvailableConditions(): Record<string, any> {
    return {
      fileCreated: {
        title: 'File Created',
        description: 'Triggered when new files are created',
        operators: ['exists', 'matches_pattern']
      },
      fileModified: {
        title: 'File Modified',
        description: 'Triggered when files are modified',
        operators: ['exists', 'newer_than']
      },
      fileDeleted: {
        title: 'File Deleted',
        description: 'Triggered when files are deleted',
        operators: ['not_exists']
      }
    };
  }
  
  /**
   * Get recent file system events from host
   */
  private async getRecentFileSystemEvents(
    hostId: string,
    watchPath: string,
    eventType: string,
    filePattern: string,
    recursive: boolean
  ): Promise<FileSystemEvent[]> {
    try {
      const events: FileSystemEvent[] = [];
      
      // Build command to check for recent file changes
      const findCommand = this.buildFindCommand(watchPath, filePattern, recursive);
      try {
        await this.sshService.executeCommand({ id: hostId }, findCommand);
        // Note: executeCommand method needs proper implementation to return stdout
        // For now, return empty events array
        return [];
      } catch (error) {
        this.logError(`Failed to execute find command: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    } catch (error) {
      this.logError('Failed to get file system events', error instanceof Error ? error.message : String(error));
      return [];
    }
  }
  
  /**
   * Build find command for file system monitoring
   */
  private buildFindCommand(watchPath: string, filePattern: string, recursive: boolean): string {
    const maxDepth = recursive ? '' : '-maxdepth 1';
    const namePattern = filePattern !== '*' ? `-name "${filePattern}"` : '';
    
    // Find files modified in last 5 minutes with details
    return `find "${watchPath}" ${maxDepth} ${namePattern} -type f -newermt "5 minutes ago" -exec stat -c "%Y %s %n" {} \\; 2>/dev/null || echo ""`;
  }
  
  /**
   * Parse file event from stat output
   */
  private parseFileEvent(line: string): FileSystemEvent | null {
    try {
      const parts = line.split(' ');
      if (parts.length >= 3) {
        const timestamp = parseInt(parts[0]) * 1000;
        const size = parseInt(parts[1]);
        const filePath = parts.slice(2).join(' ');
        
        return {
          type: 'modified', // We can only detect modifications with this method
          path: filePath,
          timestamp: new Date(timestamp),
          size: size
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Filter events based on configuration
   */
  private filterEvents(events: FileSystemEvent[], config: TriggerConfig): FileSystemEvent[] {
    const eventType = this.getConfigValue(config, 'eventType', 'any');
    const minFileSize = this.getConfigValue(config, 'minFileSize', 0);
    const maxFileAge = this.getConfigValue(config, 'maxFileAge', 300);
    const excludePatterns = this.getConfigValue(config, 'excludePatterns', []);
    
    return events.filter(event => {
      // Filter by event type
      if (eventType !== 'any' && event.type !== eventType) {
        return false;
      }
      
      // Filter by file size
      if (event.size !== undefined && event.size < minFileSize) {
        return false;
      }
      
      // Filter by age
      const ageSeconds = (Date.now() - event.timestamp.getTime()) / 1000;
      if (ageSeconds > maxFileAge) {
        return false;
      }
      
      // Filter by exclude patterns
      for (const pattern of excludePatterns) {
        if (this.matchesPattern(event.path, pattern)) {
          return false;
        }
      }
      
      return true;
    });
  }
  
  /**
   * Simple pattern matching for file paths
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path.basename(filePath)) || regex.test(filePath);
  }
}