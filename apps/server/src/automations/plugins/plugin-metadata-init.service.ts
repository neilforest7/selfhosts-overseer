import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginType, PluginStatus } from '@prisma/client';

interface BuiltinPluginDef {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  type: PluginType;
  category?: string;
  tags: string[];
}

@Injectable()
export class PluginMetadataInitService implements OnModuleInit {
  private readonly logger = new Logger(PluginMetadataInitService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBuiltinPlugins();
    } catch (error) {
      this.logger.error('Failed to ensure builtin plugin metadata', error as any);
    }
  }

  private getBuiltinPlugins(): BuiltinPluginDef[] {
    // 与脚本 scripts/seed-plugin-metadata.ts 对齐的精简清单
    const trigger = (name: string, displayName: string, description: string, category: string, tags: string[]): BuiltinPluginDef => ({
      name,
      displayName,
      description,
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category,
      tags,
    });

    const event = (name: string, displayName: string, description: string, category: string, tags: string[]): BuiltinPluginDef => ({
      name,
      displayName,
      description,
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category,
      tags,
    });

    return [
      // Triggers
      trigger('cron', 'CRON Trigger', 'Time-based trigger using CRON expressions for scheduled automation', 'Scheduling', ['scheduler', 'time-based', 'automation']),
      trigger('manual', 'Manual Trigger', 'Manually triggered automation rule', 'Manual', ['manual', 'trigger', 'user-action']),
      trigger('webhook', 'Webhook Trigger', 'HTTP webhook trigger for external system integration', 'Web', ['webhook', 'http', 'api', 'integration']),
      trigger('http-health-check', 'HTTP Health Check Trigger', 'Monitor HTTP endpoints and trigger based on response status and health', 'Monitoring', ['health-check', 'http', 'monitoring', 'web']),
      trigger('filesystem', 'File System Trigger', 'Monitor file system changes and trigger automation based on file operations', 'File System', ['filesystem', 'files', 'monitoring', 'watcher']),
      trigger('container-state', 'Container State Trigger', 'Monitor Docker container state changes and trigger automation', 'Container', ['docker', 'container', 'monitoring', 'state']),
      trigger('system-resource', 'System Resource Trigger', 'Monitor system resource usage and trigger based on thresholds', 'System', ['system', 'resources', 'monitoring', 'performance']),

      // Events
      event('log-message', 'Log Message Event', 'Create log messages for tracking and debugging automation execution', 'Logging', ['log', 'message', 'debugging', 'tracking']),
      event('restart-container', 'Restart Container Event', 'Restart Docker containers with backup and rollback support', 'Container', ['docker', 'container', 'restart', 'lifecycle']),
      event('discover-containers', 'Discover Containers Event', 'Discover and catalog containers on specified hosts', 'Container', ['docker', 'container', 'discovery', 'inventory']),
      event('check-container-updates', 'Check Container Updates Event', 'Check for container image updates and generate update reports', 'Container', ['docker', 'container', 'updates', 'maintenance']),
      event('send-notification', 'Send Notification Event', 'Send notifications via email, Slack, or webhooks', 'Notification', ['notification', 'email', 'slack', 'webhook']),
      event('execute-command', 'Execute Command Event', 'Execute commands on remote hosts', 'Execution', ['command', 'execution', 'ssh', 'remote']),
      event('file-operations', 'File Operations Event', 'Perform file operations on remote hosts', 'File System', ['files', 'operations', 'filesystem', 'management']),
      event('container-management', 'Container Management Event', 'Manage containers: start, stop, restart, update', 'Container', ['docker', 'container', 'management', 'lifecycle']),
    ];
  }

  private async ensureBuiltinPlugins(): Promise<void> {
    const plugins = this.getBuiltinPlugins();
    let created = 0;
    let updated = 0;

    for (const p of plugins) {
      await this.prisma.pluginMetadata.upsert({
        where: { name: p.name },
        create: {
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          version: p.version,
          author: p.author,
          type: p.type,
          category: p.category,
          tags: p.tags,
          isBuiltIn: true,
          isEnabled: true,
          status: PluginStatus.ACTIVE,
        },
        update: {
          displayName: p.displayName,
          description: p.description,
          version: p.version,
          author: p.author,
          type: p.type,
          category: p.category,
          tags: p.tags,
          status: PluginStatus.ACTIVE,
          isBuiltIn: true,
          isEnabled: true,
        },
      });
      // 简单统计：如果不存在则认为 created
      const exists = await this.prisma.pluginMetadata.findUnique({ where: { name: p.name } });
      if (exists) {
        // 粗略区分，日志上报即可
        updated++;
      } else {
        created++;
      }
    }

    this.logger.log(`Builtin plugin metadata ensured (created/updated total: ${plugins.length}).`);
  }
}


