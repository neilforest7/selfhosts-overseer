#!/usr/bin/env tsx

/**
 * Plugin Metadata Seeding Script
 * 
 * This script populates the PluginMetadata table with built-in plugin records.
 * This fixes the "missing database ID" error when creating automation rules.
 * 
 * Usage:
 *   npm run seed:plugin-metadata
 *   or
 *   npx tsx scripts/seed-plugin-metadata.ts
 */

import { PrismaClient, PluginType, PluginStatus } from '@prisma/client';
import { Logger } from '@nestjs/common';

interface PluginSeedData {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: string;
  type: PluginType;
  category?: string;
  tags: string[];
  configSchema?: any;
  dependencies?: string[];
  isBuiltIn: boolean;
}

interface SeedStats {
  totalPlugins: number;
  createdPlugins: number;
  existingPlugins: number;
  failedPlugins: number;
  errors: Array<{
    pluginName: string;
    error: string;
  }>;
}

class PluginMetadataSeeder {
  private readonly prisma = new PrismaClient();
  private readonly logger = new Logger('PluginMetadataSeeder');

  // Built-in plugin data based on the plugin registry
  private readonly builtinPlugins: PluginSeedData[] = [
    // Trigger Plugins
    {
      name: 'cron',
      displayName: 'CRON Trigger',
      description: 'Time-based trigger using CRON expressions for scheduled automation',
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category: 'Scheduling',
      tags: ['scheduler', 'time-based', 'automation'],
      isBuiltIn: true
    },
    {
      name: 'manual',
      displayName: 'Manual Trigger',
      description: 'Manually triggered automation rule',
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category: 'Manual',
      tags: ['manual', 'trigger', 'user-action'],
      isBuiltIn: true
    },
    {
      name: 'webhook',
      displayName: 'Webhook Trigger',
      description: 'HTTP webhook trigger for external system integration',
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category: 'Web',
      tags: ['webhook', 'http', 'api', 'integration'],
      isBuiltIn: true
    },
    {
      name: 'http-health-check',
      displayName: 'HTTP Health Check Trigger',
      description: 'Monitor HTTP endpoints and trigger based on response status and health',
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category: 'Monitoring',
      tags: ['health-check', 'http', 'monitoring', 'web'],
      isBuiltIn: true
    },
    {
      name: 'filesystem',
      displayName: 'File System Trigger',
      description: 'Monitor file system changes and trigger automation based on file operations',
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category: 'File System',
      tags: ['filesystem', 'files', 'monitoring', 'watcher'],
      isBuiltIn: true
    },
    {
      name: 'container-state',
      displayName: 'Container State Trigger',
      description: 'Monitor Docker container state changes and trigger automation',
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category: 'Container',
      tags: ['docker', 'container', 'monitoring', 'state'],
      isBuiltIn: true
    },
    {
      name: 'system-resource',
      displayName: 'System Resource Trigger',
      description: 'Monitor system resource usage (CPU, memory, disk) and trigger based on thresholds',
      version: '1.0.0',
      author: 'System',
      type: PluginType.TRIGGER,
      category: 'System',
      tags: ['system', 'resources', 'monitoring', 'performance'],
      isBuiltIn: true
    },

    // Event Plugins
    {
      name: 'log-message',
      displayName: 'Log Message Event',
      description: 'Create log messages for tracking and debugging automation execution',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'Logging',
      tags: ['log', 'message', 'debugging', 'tracking'],
      isBuiltIn: true
    },
    {
      name: 'restart-container',
      displayName: 'Restart Container Event',
      description: 'Restart Docker containers with backup and rollback support',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'Container',
      tags: ['docker', 'container', 'restart', 'lifecycle'],
      isBuiltIn: true
    },
    {
      name: 'discover-containers',
      displayName: 'Discover Containers Event',
      description: 'Discover and catalog containers on specified hosts',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'Container',
      tags: ['docker', 'container', 'discovery', 'inventory'],
      isBuiltIn: true
    },
    {
      name: 'check-container-updates',
      displayName: 'Check Container Updates Event',
      description: 'Check for container image updates and generate update reports',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'Container',
      tags: ['docker', 'container', 'updates', 'maintenance'],
      isBuiltIn: true
    },
    {
      name: 'send-notification',
      displayName: 'Send Notification Event',
      description: 'Send notifications via email, Slack, or webhooks based on execution results',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'Notification',
      tags: ['notification', 'email', 'slack', 'webhook'],
      isBuiltIn: true
    },
    {
      name: 'execute-command',
      displayName: 'Execute Command Event',
      description: 'Execute commands on remote hosts with configurable user and timeout settings',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'Execution',
      tags: ['command', 'execution', 'ssh', 'remote'],
      isBuiltIn: true
    },
    {
      name: 'file-operations',
      displayName: 'File Operations Event',
      description: 'Perform file system operations like copy, move, delete on remote hosts',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'File System',
      tags: ['files', 'operations', 'filesystem', 'management'],
      isBuiltIn: true
    },
    {
      name: 'container-management',
      displayName: 'Container Management Event',
      description: 'Comprehensive container management including start, stop, restart, and update operations',
      version: '1.0.0',
      author: 'System',
      type: PluginType.EVENT,
      category: 'Container',
      tags: ['docker', 'container', 'management', 'lifecycle'],
      isBuiltIn: true
    }
  ];

  async seed(dryRun: boolean = false): Promise<SeedStats> {
    const stats: SeedStats = {
      totalPlugins: this.builtinPlugins.length,
      createdPlugins: 0,
      existingPlugins: 0,
      failedPlugins: 0,
      errors: []
    };

    try {
      this.logger.log(`Starting plugin metadata seeding (dry run: ${dryRun})`);

      for (const pluginData of this.builtinPlugins) {
        try {
          const result = await this.seedPlugin(pluginData, dryRun);
          
          if (result.created) {
            stats.createdPlugins++;
            this.logger.log(`✓ Created plugin metadata: ${pluginData.name} (${pluginData.displayName})`);
          } else {
            stats.existingPlugins++;
            this.logger.log(`✓ Plugin metadata already exists: ${pluginData.name}`);
          }
        } catch (error) {
          stats.failedPlugins++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          stats.errors.push({
            pluginName: pluginData.name,
            error: errorMessage
          });
          this.logger.error(`✗ Failed to seed plugin ${pluginData.name}: ${errorMessage}`);
        }
      }

      this.logger.log('Plugin metadata seeding completed');
      this.printSeedReport(stats, dryRun);

      return stats;

    } catch (error) {
      this.logger.error('Plugin metadata seeding failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  private async seedPlugin(pluginData: PluginSeedData, dryRun: boolean): Promise<{
    created: boolean;
    pluginId?: string;
  }> {
    // Check if plugin already exists
    const existingPlugin = await this.prisma.pluginMetadata.findUnique({
      where: { name: pluginData.name }
    });

    if (existingPlugin) {
      // Update existing plugin if needed
      if (!dryRun) {
        await this.prisma.pluginMetadata.update({
          where: { name: pluginData.name },
          data: {
            displayName: pluginData.displayName,
            description: pluginData.description,
            version: pluginData.version,
            author: pluginData.author,
            type: pluginData.type,
            category: pluginData.category,
            tags: pluginData.tags,
            configSchema: pluginData.configSchema,
            dependencies: pluginData.dependencies,
            isBuiltIn: pluginData.isBuiltIn,
            status: PluginStatus.ACTIVE
          }
        });
      }
      
      return { created: false, pluginId: existingPlugin.id };
    }

    // Create new plugin
    if (!dryRun) {
      const newPlugin = await this.prisma.pluginMetadata.create({
        data: {
          name: pluginData.name,
          displayName: pluginData.displayName,
          description: pluginData.description,
          version: pluginData.version,
          author: pluginData.author,
          type: pluginData.type,
          category: pluginData.category,
          tags: pluginData.tags,
          configSchema: pluginData.configSchema,
          dependencies: pluginData.dependencies || [],
          isEnabled: true,
          isBuiltIn: pluginData.isBuiltIn,
          status: PluginStatus.ACTIVE
        }
      });

      return { created: true, pluginId: newPlugin.id };
    }

    return { created: true };
  }

  private printSeedReport(stats: SeedStats, dryRun: boolean): void {
    this.logger.log('\n' + '='.repeat(60));
    this.logger.log(`PLUGIN METADATA SEEDING REPORT ${dryRun ? '(DRY RUN)' : ''}`);
    this.logger.log('='.repeat(60));
    this.logger.log(`Total Plugins: ${stats.totalPlugins}`);
    this.logger.log(`Created Plugins: ${stats.createdPlugins}`);
    this.logger.log(`Existing Plugins: ${stats.existingPlugins}`);
    this.logger.log(`Failed Plugins: ${stats.failedPlugins}`);
    
    if (stats.errors.length > 0) {
      this.logger.log('\nErrors:');
      stats.errors.forEach((error, index) => {
        this.logger.log(`  ${index + 1}. ${error.pluginName}: ${error.error}`);
      });
    }

    const successRate = stats.totalPlugins > 0 
      ? Math.round(((stats.createdPlugins + stats.existingPlugins) / stats.totalPlugins) * 100)
      : 100;
    
    this.logger.log(`\nSuccess Rate: ${successRate}%`);
    this.logger.log('='.repeat(60));
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-d');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
Plugin Metadata Seeding Script

Usage:
  npx tsx scripts/seed-plugin-metadata.ts [options]

Options:
  --dry-run, -d    Run in dry-run mode (no database changes)
  --help, -h       Show this help message

Examples:
  npx tsx scripts/seed-plugin-metadata.ts --dry-run
  npx tsx scripts/seed-plugin-metadata.ts
`);
    process.exit(0);
  }

  const seeder = new PluginMetadataSeeder();
  
  try {
    const stats = await seeder.seed(dryRun);
    
    if (dryRun) {
      console.log('\nDry run completed. Use without --dry-run to apply changes.');
    } else {
      console.log('\nPlugin metadata seeding completed successfully!');
      console.log('This should resolve the "missing database ID" errors when creating automation rules.');
    }
    
    process.exit(stats.failedPlugins > 0 ? 1 : 0);
  } catch (error) {
    console.error('Plugin metadata seeding failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { PluginMetadataSeeder, SeedStats };