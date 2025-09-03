#!/usr/bin/env tsx

/**
 * FRP Relationship Migration Script
 * 
 * This script fixes existing broken FRP relationships by:
 * 1. Identifying orphaned FRPC proxies (those with null frpsConfigId)
 * 2. Attempting to link them to their corresponding FRPS configs
 * 3. Updating sync status and clearing error messages
 * 4. Providing detailed migration report
 * 
 * Usage:
 *   npm run migrate:frp-relationships
 *   or
 *   npx tsx scripts/migrate-frp-relationships.ts
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

interface MigrationStats {
  totalFrpcProxies: number;
  orphanedProxies: number;
  successfullyLinked: number;
  failedToLink: number;
  alreadyLinked: number;
  errors: Array<{
    proxyId: string;
    proxyName: string;
    error: string;
  }>;
}

class FrpRelationshipMigrator {
  private readonly prisma = new PrismaClient();
  private readonly logger = new Logger('FrpRelationshipMigrator');

  async migrate(dryRun: boolean = false): Promise<MigrationStats> {
    const stats: MigrationStats = {
      totalFrpcProxies: 0,
      orphanedProxies: 0,
      successfullyLinked: 0,
      failedToLink: 0,
      alreadyLinked: 0,
      errors: []
    };

    try {
      this.logger.log(`Starting FRP relationship migration (dry run: ${dryRun})`);

      // Get all FRPC proxies
      const allProxies = await this.prisma.frpcProxy.findMany({
        include: {
          frps: true
        }
      });

      stats.totalFrpcProxies = allProxies.length;
      this.logger.log(`Found ${stats.totalFrpcProxies} FRPC proxies`);

      // Identify different categories
      const orphanedProxies = allProxies.filter(p => !p.frpsConfigId);
      const linkedProxies = allProxies.filter(p => p.frpsConfigId && p.frps);
      const brokenProxies = allProxies.filter(p => p.frpsConfigId && !p.frps);

      stats.orphanedProxies = orphanedProxies.length;
      stats.alreadyLinked = linkedProxies.length;

      this.logger.log(`Orphaned proxies (no frpsConfigId): ${stats.orphanedProxies}`);
      this.logger.log(`Already linked proxies: ${stats.alreadyLinked}`);
      this.logger.log(`Broken proxies (invalid frpsConfigId): ${brokenProxies.length}`);

      // Fix broken proxies first (reset them to orphaned state)
      if (brokenProxies.length > 0) {
        this.logger.log(`Resetting ${brokenProxies.length} broken proxies to orphaned state`);
        
        if (!dryRun) {
          for (const proxy of brokenProxies) {
            await this.prisma.frpcProxy.update({
              where: { id: proxy.id },
              data: {
                frpsConfigId: null,
                syncStatus: 'pending',
                linkErrorMessage: 'Reset during migration - invalid FRPS config reference'
              }
            });
          }
        }
        
        // Add broken proxies to orphaned list for processing
        orphanedProxies.push(...brokenProxies);
        stats.orphanedProxies += brokenProxies.length;
      }

      // Process orphaned proxies
      for (const proxy of orphanedProxies) {
        try {
          const result = await this.linkOrphanedProxy(proxy, dryRun);
          if (result.success) {
            stats.successfullyLinked++;
            this.logger.log(`✓ Linked proxy ${proxy.name} to FRPS config ${result.frpsConfigId}`);
          } else {
            stats.failedToLink++;
            stats.errors.push({
              proxyId: proxy.id,
              proxyName: proxy.name,
              error: result.error || 'Unknown error'
            });
            this.logger.warn(`✗ Failed to link proxy ${proxy.name}: ${result.error}`);
          }
        } catch (error) {
          stats.failedToLink++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          stats.errors.push({
            proxyId: proxy.id,
            proxyName: proxy.name,
            error: errorMessage
          });
          this.logger.error(`✗ Error processing proxy ${proxy.name}: ${errorMessage}`);
        }
      }

      this.logger.log('Migration completed');
      this.printMigrationReport(stats, dryRun);

      return stats;

    } catch (error) {
      this.logger.error('Migration failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  private async linkOrphanedProxy(proxy: any, dryRun: boolean): Promise<{
    success: boolean;
    frpsConfigId?: string;
    error?: string;
  }> {
    // Extract server info from pending fields or raw config
    let serverAddr = proxy.pendingServerAddr;
    let serverPort = proxy.pendingServerPort;

    // If pending fields are empty, try to extract from raw config
    if (!serverAddr || !serverPort) {
      const configResult = this.extractServerInfoFromRawConfig(proxy.rawConfig);
      if (configResult) {
        serverAddr = configResult.serverAddr;
        serverPort = configResult.serverPort;
      }
    }

    if (!serverAddr || !serverPort) {
      return {
        success: false,
        error: 'Missing server address or port information'
      };
    }

    // Find the FRPS host
    const frpsHost = await this.prisma.host.findFirst({
      where: { address: serverAddr }
    });

    if (!frpsHost) {
      return {
        success: false,
        error: `FRPS host not found: ${serverAddr}`
      };
    }

    // Find the FRPS config
    const frpsConfig = await this.prisma.frpsConfig.findFirst({
      where: {
        hostId: frpsHost.id,
        bindPort: serverPort
      }
    });

    if (!frpsConfig) {
      return {
        success: false,
        error: `FRPS config not found on host ${frpsHost.name} with bind_port ${serverPort}`
      };
    }

    // Link the proxy
    if (!dryRun) {
      await this.prisma.frpcProxy.update({
        where: { id: proxy.id },
        data: {
          frpsConfigId: frpsConfig.id,
          syncStatus: 'linked',
          pendingServerAddr: serverAddr, // Keep for reference
          pendingServerPort: serverPort, // Keep for reference
          lastLinkAttempt: new Date(),
          linkErrorMessage: null
        }
      });
    }

    return {
      success: true,
      frpsConfigId: frpsConfig.id
    };
  }

  private extractServerInfoFromRawConfig(rawConfig: any): {
    serverAddr: string;
    serverPort: number;
  } | null {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return null;
    }

    // Try to extract from common section
    const common = rawConfig.common || rawConfig;
    const serverAddr = common.server_addr || common.serverAddr;
    const serverPort = common.server_port || common.serverPort;

    if (serverAddr && serverPort) {
      return {
        serverAddr: String(serverAddr),
        serverPort: Number(serverPort)
      };
    }

    return null;
  }

  private printMigrationReport(stats: MigrationStats, dryRun: boolean): void {
    this.logger.log('\n' + '='.repeat(60));
    this.logger.log(`FRP RELATIONSHIP MIGRATION REPORT ${dryRun ? '(DRY RUN)' : ''}`);
    this.logger.log('='.repeat(60));
    this.logger.log(`Total FRPC Proxies: ${stats.totalFrpcProxies}`);
    this.logger.log(`Already Linked: ${stats.alreadyLinked}`);
    this.logger.log(`Orphaned Proxies: ${stats.orphanedProxies}`);
    this.logger.log(`Successfully Linked: ${stats.successfullyLinked}`);
    this.logger.log(`Failed to Link: ${stats.failedToLink}`);
    
    if (stats.errors.length > 0) {
      this.logger.log('\nErrors:');
      stats.errors.forEach((error, index) => {
        this.logger.log(`  ${index + 1}. ${error.proxyName} (${error.proxyId}): ${error.error}`);
      });
    }

    const successRate = stats.orphanedProxies > 0 
      ? Math.round((stats.successfullyLinked / stats.orphanedProxies) * 100)
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
FRP Relationship Migration Script

Usage:
  npx tsx scripts/migrate-frp-relationships.ts [options]

Options:
  --dry-run, -d    Run in dry-run mode (no database changes)
  --help, -h       Show this help message

Examples:
  npx tsx scripts/migrate-frp-relationships.ts --dry-run
  npx tsx scripts/migrate-frp-relationships.ts
`);
    process.exit(0);
  }

  const migrator = new FrpRelationshipMigrator();
  
  try {
    const stats = await migrator.migrate(dryRun);
    
    if (dryRun) {
      console.log('\nDry run completed. Use without --dry-run to apply changes.');
    } else {
      console.log('\nMigration completed successfully!');
    }
    
    process.exit(stats.failedToLink > 0 ? 1 : 0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { FrpRelationshipMigrator, MigrationStats };
