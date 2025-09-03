#!/usr/bin/env tsx

/**
 * FRP State Debug Script
 * 
 * This script helps debug the current state of FRP configurations and proxies
 * to identify why automatic dependency resolution is not working.
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

class FrpStateDebugger {
  private readonly prisma = new PrismaClient();
  private readonly logger = new Logger('FrpStateDebugger');

  async debugCurrentState(): Promise<void> {
    try {
      this.logger.log('='.repeat(60));
      this.logger.log('FRP STATE DEBUG REPORT');
      this.logger.log('='.repeat(60));

      // Get all hosts
      const hosts = await this.prisma.host.findMany({
        select: {
          id: true,
          name: true,
          address: true
        }
      });

      this.logger.log(`\nHOSTS (${hosts.length}):`);
      hosts.forEach(host => {
        this.logger.log(`  - ${host.name} (${host.address}) [${host.id}]`);
      });

      // Get all FRPS configs
      const frpsConfigs = await this.prisma.frpsConfig.findMany();

      this.logger.log(`\nFRPS CONFIGS (${frpsConfigs.length}):`);
      frpsConfigs.forEach(config => {
        const host = hosts.find(h => h.id === config.hostId);
        this.logger.log(`  - Host: ${host?.name || 'Unknown'} (${host?.address || 'Unknown'})`);
        this.logger.log(`    Bind Port: ${config.bindPort}`);
        this.logger.log(`    Config ID: ${config.id}`);
        this.logger.log(`    Container ID: ${config.containerId}`);
        this.logger.log('');
      });

      // Get all FRPC proxies
      const frpcProxies = await this.prisma.frpcProxy.findMany();

      this.logger.log(`\nFRPC PROXIES (${frpcProxies.length}):`);
      frpcProxies.forEach(proxy => {
        const host = hosts.find(h => h.id === proxy.hostId);
        this.logger.log(`  - Proxy: ${proxy.name} on ${host?.name || 'Unknown'} (${host?.address || 'Unknown'})`);
        this.logger.log(`    Status: ${proxy.syncStatus}`);
        this.logger.log(`    Pending Server: ${proxy.pendingServerAddr}:${proxy.pendingServerPort}`);
        this.logger.log(`    FRPS Config ID: ${proxy.frpsConfigId || 'NULL'}`);
        if (proxy.frpsConfigId) {
          const linkedFrps = frpsConfigs.find(f => f.id === proxy.frpsConfigId);
          if (linkedFrps) {
            const frpsHost = hosts.find(h => h.id === linkedFrps.hostId);
            this.logger.log(`    Linked to FRPS: ${frpsHost?.name || 'Unknown'} (${frpsHost?.address || 'Unknown'}):${linkedFrps.bindPort}`);
          }
        }
        if (proxy.linkErrorMessage) {
          this.logger.log(`    Error: ${proxy.linkErrorMessage}`);
        }
        this.logger.log(`    Last Link Attempt: ${proxy.lastLinkAttempt || 'Never'}`);
        this.logger.log('');
      });

      // Analyze potential matches
      this.logger.log('\nPOTENTIAL MATCHES ANALYSIS:');
      const pendingProxies = frpcProxies.filter(p => p.syncStatus === 'pending');
      
      for (const proxy of pendingProxies) {
        this.logger.log(`\nAnalyzing pending proxy: ${proxy.name}`);
        this.logger.log(`  Looking for FRPS at: ${proxy.pendingServerAddr}:${proxy.pendingServerPort}`);
        
        // Find matching host
        const matchingHost = hosts.find(h => h.address === proxy.pendingServerAddr);
        if (!matchingHost) {
          this.logger.log(`  ❌ No host found with address: ${proxy.pendingServerAddr}`);
          continue;
        }
        
        this.logger.log(`  ✅ Found matching host: ${matchingHost.name} [${matchingHost.id}]`);
        
        // Find matching FRPS config
        const matchingFrpsConfig = frpsConfigs.find(c => 
          c.hostId === matchingHost.id && c.bindPort === proxy.pendingServerPort
        );
        
        if (!matchingFrpsConfig) {
          this.logger.log(`  ❌ No FRPS config found on host ${matchingHost.name} with bind_port ${proxy.pendingServerPort}`);
          this.logger.log(`  Available FRPS configs on this host:`);
          const hostConfigs = frpsConfigs.filter(c => c.hostId === matchingHost.id);
          if (hostConfigs.length === 0) {
            this.logger.log(`    (none)`);
          } else {
            hostConfigs.forEach(c => {
              this.logger.log(`    - bind_port: ${c.bindPort}, id: ${c.id}`);
            });
          }
        } else {
          this.logger.log(`  ✅ Found matching FRPS config: ${matchingFrpsConfig.id}`);
          this.logger.log(`  🔗 This proxy SHOULD be linked automatically!`);
        }
      }

      // Summary
      const linkedCount = frpcProxies.filter(p => p.syncStatus === 'linked').length;
      const pendingCount = frpcProxies.filter(p => p.syncStatus === 'pending').length;
      const failedCount = frpcProxies.filter(p => p.syncStatus === 'failed').length;

      this.logger.log('\nSUMMARY:');
      this.logger.log(`  Total FRPS Configs: ${frpsConfigs.length}`);
      this.logger.log(`  Total FRPC Proxies: ${frpcProxies.length}`);
      this.logger.log(`    - Linked: ${linkedCount}`);
      this.logger.log(`    - Pending: ${pendingCount}`);
      this.logger.log(`    - Failed: ${failedCount}`);

      if (pendingCount > 0) {
        this.logger.log(`\n⚠️  There are ${pendingCount} pending proxies that should be resolved!`);
      }

      this.logger.log('='.repeat(60));

    } catch (error) {
      this.logger.error('Debug failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  async testDependencyResolution(): Promise<void> {
    try {
      this.logger.log('\n' + '='.repeat(60));
      this.logger.log('TESTING DEPENDENCY RESOLUTION');
      this.logger.log('='.repeat(60));

      // Get pending proxies before resolution
      const pendingBefore = await this.prisma.frpcProxy.findMany({
        where: { syncStatus: 'pending' },
        select: {
          id: true,
          name: true,
          pendingServerAddr: true,
          pendingServerPort: true
        }
      });

      this.logger.log(`\nPending proxies before resolution: ${pendingBefore.length}`);
      pendingBefore.forEach(p => {
        this.logger.log(`  - ${p.name}: ${p.pendingServerAddr}:${p.pendingServerPort}`);
      });

      if (pendingBefore.length === 0) {
        this.logger.log('No pending proxies to resolve.');
        return;
      }

      // Simulate dependency resolution logic
      this.logger.log('\nSimulating dependency resolution...');
      
      for (const proxy of pendingBefore) {
        this.logger.log(`\nProcessing proxy: ${proxy.name}`);
        
        // Find FRPS host
        const frpsHost = proxy.pendingServerAddr ? await this.prisma.host.findFirst({
          where: { address: proxy.pendingServerAddr }
        }) : null;

        if (!frpsHost) {
          this.logger.log(`  ❌ FRPS host not found: ${proxy.pendingServerAddr}`);
          continue;
        }

        this.logger.log(`  ✅ Found FRPS host: ${frpsHost.name} [${frpsHost.id}]`);

        // Find FRPS config
        const frpsConfig = await this.prisma.frpsConfig.findFirst({
          where: {
            hostId: frpsHost.id,
            bindPort: proxy.pendingServerPort
          }
        });

        if (!frpsConfig) {
          this.logger.log(`  ❌ FRPS config not found on host ${frpsHost.name} with bind_port ${proxy.pendingServerPort}`);
          continue;
        }

        this.logger.log(`  ✅ Found FRPS config: ${frpsConfig.id}`);
        this.logger.log(`  🔗 Proxy ${proxy.name} CAN be linked to FRPS config ${frpsConfig.id}`);
      }

      this.logger.log('='.repeat(60));

    } catch (error) {
      this.logger.error('Dependency resolution test failed:', error);
      throw error;
    }
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');
  const testResolution = args.includes('--test-resolution');

  if (help) {
    console.log(`
FRP State Debug Script

Usage:
  npx tsx scripts/debug-frp-state.ts [options]

Options:
  --test-resolution    Test dependency resolution logic
  --help, -h          Show this help message

Examples:
  npx tsx scripts/debug-frp-state.ts
  npx tsx scripts/debug-frp-state.ts --test-resolution
`);
    process.exit(0);
  }

  const frpDebugger = new FrpStateDebugger();

  try {
    await frpDebugger.debugCurrentState();

    if (testResolution) {
      await frpDebugger.testDependencyResolution();
    }
    
    console.log('\n✅ Debug completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Debug failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { FrpStateDebugger };
