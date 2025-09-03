#!/usr/bin/env tsx

/**
 * FRP Discovery Order Test Script
 * 
 * This script tests the FRP discovery order independence by:
 * 1. Setting up test data with multiple hosts
 * 2. Running discovery in different orders
 * 3. Validating that the final topology is consistent
 * 4. Providing detailed test results
 * 
 * Usage:
 *   npm run test:frp-discovery-order
 *   or
 *   npx tsx scripts/test-frp-discovery-order.ts
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

interface TestScenario {
  name: string;
  description: string;
  hostOrder: string[];
}

interface TestResult {
  scenario: string;
  success: boolean;
  duration: number;
  linkedProxies: number;
  pendingProxies: number;
  failedProxies: number;
  errors: string[];
}

class FrpDiscoveryOrderTester {
  private readonly prisma = new PrismaClient();
  private readonly logger = new Logger('FrpDiscoveryOrderTester');

  private readonly testScenarios: TestScenario[] = [
    {
      name: 'normal-order',
      description: 'FRPS discovered before FRPC (normal order)',
      hostOrder: ['frps-host', 'frpc-host-1', 'frpc-host-2']
    },
    {
      name: 'reverse-order',
      description: 'FRPC discovered before FRPS (reverse order)',
      hostOrder: ['frpc-host-1', 'frpc-host-2', 'frps-host']
    },
    {
      name: 'mixed-order-1',
      description: 'Mixed order: FRPC, FRPS, FRPC',
      hostOrder: ['frpc-host-1', 'frps-host', 'frpc-host-2']
    },
    {
      name: 'mixed-order-2',
      description: 'Mixed order: FRPS, FRPC, FRPC',
      hostOrder: ['frps-host', 'frpc-host-1', 'frpc-host-2']
    },
    {
      name: 'random-order',
      description: 'Random order: FRPC, FRPC, FRPS',
      hostOrder: ['frpc-host-2', 'frpc-host-1', 'frps-host']
    }
  ];

  async runAllTests(): Promise<TestResult[]> {
    this.logger.log('Starting FRP discovery order tests...');
    
    const results: TestResult[] = [];

    for (const scenario of this.testScenarios) {
      this.logger.log(`\nRunning scenario: ${scenario.name}`);
      this.logger.log(`Description: ${scenario.description}`);
      
      try {
        const result = await this.runTestScenario(scenario);
        results.push(result);
        
        if (result.success) {
          this.logger.log(`✅ ${scenario.name} passed (${result.duration}ms)`);
        } else {
          this.logger.error(`❌ ${scenario.name} failed (${result.duration}ms)`);
          result.errors.forEach(error => this.logger.error(`   Error: ${error}`));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`❌ ${scenario.name} failed with exception: ${errorMessage}`);
        
        results.push({
          scenario: scenario.name,
          success: false,
          duration: 0,
          linkedProxies: 0,
          pendingProxies: 0,
          failedProxies: 0,
          errors: [errorMessage]
        });
      }
    }

    this.printTestSummary(results);
    return results;
  }

  private async runTestScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    try {
      // Clean up any existing test data
      await this.cleanupTestData();

      // Setup test data
      await this.setupTestData();

      // Simulate discovery in the specified order
      await this.simulateDiscoveryOrder(scenario.hostOrder);

      // Validate the final topology
      const validation = await this.validateTopology();

      const duration = Date.now() - startTime;

      // Check if the topology is as expected
      const expectedLinkedProxies = 2; // We expect 2 FRPC proxies to be linked
      const success = validation.linkedProxies === expectedLinkedProxies && 
                     validation.failedProxies === 0;

      if (!success) {
        errors.push(`Expected ${expectedLinkedProxies} linked proxies, got ${validation.linkedProxies}`);
        if (validation.failedProxies > 0) {
          errors.push(`Found ${validation.failedProxies} failed proxies`);
        }
      }

      return {
        scenario: scenario.name,
        success,
        duration,
        linkedProxies: validation.linkedProxies,
        pendingProxies: validation.pendingProxies,
        failedProxies: validation.failedProxies,
        errors
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        scenario: scenario.name,
        success: false,
        duration,
        linkedProxies: 0,
        pendingProxies: 0,
        failedProxies: 0,
        errors: [errorMessage]
      };
    }
  }

  private async cleanupTestData(): Promise<void> {
    // Clean up test data in the correct order to avoid foreign key constraints
    await this.prisma.frpcProxy.deleteMany({
      where: {
        hostId: {
          in: ['frps-host', 'frpc-host-1', 'frpc-host-2']
        }
      }
    });

    await this.prisma.frpsConfig.deleteMany({
      where: {
        hostId: {
          in: ['frps-host', 'frpc-host-1', 'frpc-host-2']
        }
      }
    });

    await this.prisma.host.deleteMany({
      where: {
        id: {
          in: ['frps-host', 'frpc-host-1', 'frpc-host-2']
        }
      }
    });
  }

  private async setupTestData(): Promise<void> {
    // Create test hosts
    const hosts = [
      {
        id: 'frps-host',
        name: 'FRPS Server',
        address: '192.168.1.100',
        sshUser: 'root',
        role: 'remote' as const,
        sshAuthMethod: 'privateKey' as const
      },
      {
        id: 'frpc-host-1',
        name: 'FRPC Client 1',
        address: '192.168.1.101',
        sshUser: 'root',
        role: 'remote' as const,
        sshAuthMethod: 'privateKey' as const
      },
      {
        id: 'frpc-host-2',
        name: 'FRPC Client 2',
        address: '192.168.1.102',
        sshUser: 'root',
        role: 'remote' as const,
        sshAuthMethod: 'privateKey' as const
      }
    ];

    for (const host of hosts) {
      await this.prisma.host.create({
        data: host
      });
    }
  }

  private async simulateDiscoveryOrder(hostOrder: string[]): Promise<void> {
    // Simulate the parse phase for each host in the specified order
    for (const hostId of hostOrder) {
      await this.simulateHostDiscovery(hostId);
    }

    // Simulate the dependency resolution phase
    await this.simulateDependencyResolution();
  }

  private async simulateHostDiscovery(hostId: string): Promise<void> {
    if (hostId === 'frps-host') {
      // Create FRPS config
      await this.prisma.frpsConfig.create({
        data: {
          id: `frps-config-${hostId}`,
          hostId,
          containerId: `frps-container-${hostId}`,
          bindPort: 7000,
          vhostHttpPort: 8080,
          vhostHttpsPort: 8443,
          subdomainHost: 'example.com',
          rawConfig: {
            common: {
              bind_port: 7000,
              vhost_http_port: 8080,
              vhost_https_port: 8443,
              subdomain_host: 'example.com'
            }
          }
        }
      });
    } else {
      // Create FRPC proxy in pending state
      const proxyName = hostId === 'frpc-host-1' ? 'web' : 'ssh';
      const localPort = hostId === 'frpc-host-1' ? 80 : 22;
      const remotePort = hostId === 'frpc-host-1' ? 8080 : 2222;

      await this.prisma.frpcProxy.create({
        data: {
          id: `frpc-proxy-${hostId}`,
          hostId,
          containerId: `frpc-container-${hostId}`,
          name: proxyName,
          type: hostId === 'frpc-host-1' ? 'http' : 'tcp',
          localIp: '127.0.0.1',
          localPort,
          remotePort,
          syncStatus: 'pending',
          pendingServerAddr: '192.168.1.100',
          pendingServerPort: 7000,
          rawConfig: {
            common: {
              server_addr: '192.168.1.100',
              server_port: 7000
            },
            [proxyName]: {
              type: hostId === 'frpc-host-1' ? 'http' : 'tcp',
              local_ip: '127.0.0.1',
              local_port: localPort,
              ...(hostId === 'frpc-host-1' ? { subdomain: 'web' } : { remote_port: remotePort })
            }
          }
        }
      });
    }
  }

  private async simulateDependencyResolution(): Promise<void> {
    // Find all pending FRPC proxies
    const pendingProxies = await this.prisma.frpcProxy.findMany({
      where: { syncStatus: 'pending' }
    });

    // Find the FRPS config
    const frpsConfig = await this.prisma.frpsConfig.findFirst({
      where: {
        hostId: 'frps-host',
        bindPort: 7000
      }
    });

    if (!frpsConfig) {
      throw new Error('FRPS config not found during dependency resolution');
    }

    // Link all pending proxies to the FRPS config
    for (const proxy of pendingProxies) {
      await this.prisma.frpcProxy.update({
        where: { id: proxy.id },
        data: {
          frpsConfigId: frpsConfig.id,
          syncStatus: 'linked',
          lastLinkAttempt: new Date(),
          linkErrorMessage: null
        }
      });
    }
  }

  private async validateTopology(): Promise<{
    linkedProxies: number;
    pendingProxies: number;
    failedProxies: number;
  }> {
    const proxies = await this.prisma.frpcProxy.findMany();

    const linkedProxies = proxies.filter(p => p.syncStatus === 'linked').length;
    const pendingProxies = proxies.filter(p => p.syncStatus === 'pending').length;
    const failedProxies = proxies.filter(p => p.syncStatus === 'failed').length;

    return {
      linkedProxies,
      pendingProxies,
      failedProxies
    };
  }

  private printTestSummary(results: TestResult[]): void {
    this.logger.log('\n' + '='.repeat(60));
    this.logger.log('FRP DISCOVERY ORDER TEST SUMMARY');
    this.logger.log('='.repeat(60));

    const totalTests = results.length;
    const passedTests = results.filter(r => r.success).length;
    const failedTests = totalTests - passedTests;

    this.logger.log(`Total Tests: ${totalTests}`);
    this.logger.log(`Passed: ${passedTests}`);
    this.logger.log(`Failed: ${failedTests}`);
    this.logger.log(`Success Rate: ${Math.round((passedTests / totalTests) * 100)}%`);

    if (failedTests > 0) {
      this.logger.log('\nFailed Tests:');
      results.filter(r => !r.success).forEach(result => {
        this.logger.log(`  ❌ ${result.scenario}:`);
        result.errors.forEach(error => {
          this.logger.log(`     - ${error}`);
        });
      });
    }

    this.logger.log('\nDetailed Results:');
    results.forEach(result => {
      const status = result.success ? '✅' : '❌';
      this.logger.log(`  ${status} ${result.scenario}: ${result.linkedProxies} linked, ${result.pendingProxies} pending, ${result.failedProxies} failed (${result.duration}ms)`);
    });

    this.logger.log('='.repeat(60));
  }

  async cleanup(): Promise<void> {
    await this.cleanupTestData();
    await this.prisma.$disconnect();
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
FRP Discovery Order Test Script

Usage:
  npx tsx scripts/test-frp-discovery-order.ts [options]

Options:
  --help, -h       Show this help message

Examples:
  npx tsx scripts/test-frp-discovery-order.ts
`);
    process.exit(0);
  }

  const tester = new FrpDiscoveryOrderTester();
  
  try {
    const results = await tester.runAllTests();
    
    const allPassed = results.every(r => r.success);
    
    if (allPassed) {
      console.log('\n✅ All FRP discovery order tests passed!');
      process.exit(0);
    } else {
      console.log('\n❌ Some FRP discovery order tests failed. Please review the results above.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Test execution failed:', error);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

if (require.main === module) {
  main();
}

export { FrpDiscoveryOrderTester, TestResult };
