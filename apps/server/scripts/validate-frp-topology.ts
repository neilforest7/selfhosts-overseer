#!/usr/bin/env tsx

/**
 * FRP Topology Validation Script
 * 
 * This script validates the FRP topology health and provides detailed reports:
 * 1. Checks all FRPC proxy relationships
 * 2. Validates FRPS config integrity
 * 3. Identifies potential issues
 * 4. Provides recommendations for fixes
 * 
 * Usage:
 *   npm run validate:frp-topology
 *   or
 *   npx tsx scripts/validate-frp-topology.ts
 */

import { PrismaClient } from '@prisma/client';
import { Logger } from '@nestjs/common';

interface ValidationReport {
  summary: {
    totalFrpsConfigs: number;
    totalFrpcProxies: number;
    healthyProxies: number;
    unhealthyProxies: number;
    healthPercentage: number;
  };
  details: {
    linkedProxies: number;
    pendingProxies: number;
    failedProxies: number;
    orphanedProxies: number;
    stalePendingProxies: number;
  };
  issues: Array<{
    type: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    count?: number;
    items?: string[];
  }>;
  recommendations: string[];
}

class FrpTopologyValidator {
  private readonly prisma = new PrismaClient();
  private readonly logger = new Logger('FrpTopologyValidator');

  async validate(): Promise<ValidationReport> {
    const report: ValidationReport = {
      summary: {
        totalFrpsConfigs: 0,
        totalFrpcProxies: 0,
        healthyProxies: 0,
        unhealthyProxies: 0,
        healthPercentage: 0
      },
      details: {
        linkedProxies: 0,
        pendingProxies: 0,
        failedProxies: 0,
        orphanedProxies: 0,
        stalePendingProxies: 0
      },
      issues: [],
      recommendations: []
    };

    try {
      this.logger.log('Starting FRP topology validation...');

      // Get all data
      const [frpsConfigs, frpcProxies] = await Promise.all([
        this.prisma.frpsConfig.findMany({
          include: {
            host: true,
            proxies: true
          }
        }),
        this.prisma.frpcProxy.findMany({
          include: {
            frps: {
              include: {
                host: true
              }
            }
          }
        })
      ]);

      // Basic counts
      report.summary.totalFrpsConfigs = frpsConfigs.length;
      report.summary.totalFrpcProxies = frpcProxies.length;

      // Categorize proxies
      const linkedProxies = frpcProxies.filter(p => p.syncStatus === 'linked' && p.frpsConfigId);
      const pendingProxies = frpcProxies.filter(p => p.syncStatus === 'pending');
      const failedProxies = frpcProxies.filter(p => p.syncStatus === 'failed');
      const orphanedProxies = frpcProxies.filter(p => !p.frpsConfigId);

      report.details.linkedProxies = linkedProxies.length;
      report.details.pendingProxies = pendingProxies.length;
      report.details.failedProxies = failedProxies.length;
      report.details.orphanedProxies = orphanedProxies.length;

      // Calculate health
      report.summary.healthyProxies = linkedProxies.length;
      report.summary.unhealthyProxies = pendingProxies.length + failedProxies.length + orphanedProxies.length;
      report.summary.healthPercentage = report.summary.totalFrpcProxies > 0
        ? Math.round((report.summary.healthyProxies / report.summary.totalFrpcProxies) * 100)
        : 100;

      // Check for stale pending proxies
      const staleThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const stalePendingProxies = pendingProxies.filter(p => 
        p.lastLinkAttempt && p.lastLinkAttempt < staleThreshold
      );
      report.details.stalePendingProxies = stalePendingProxies.length;

      // Analyze issues
      this.analyzeIssues(report, frpsConfigs, frpcProxies, {
        linkedProxies,
        pendingProxies,
        failedProxies,
        orphanedProxies,
        stalePendingProxies
      });

      // Generate recommendations
      this.generateRecommendations(report);

      this.logger.log('Validation completed');
      this.printValidationReport(report);

      return report;

    } catch (error) {
      this.logger.error('Validation failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  private analyzeIssues(
    report: ValidationReport,
    frpsConfigs: any[],
    frpcProxies: any[],
    categorized: any
  ): void {
    const { linkedProxies, pendingProxies, failedProxies, orphanedProxies, stalePendingProxies } = categorized;

    // Critical issues
    if (orphanedProxies.length > 0) {
      report.issues.push({
        type: 'error',
        category: 'Orphaned Proxies',
        message: `${orphanedProxies.length} FRPC proxies have no FRPS config reference`,
        count: orphanedProxies.length,
        items: orphanedProxies.slice(0, 5).map((p: any) => `${p.name} (${p.id})`)
      });
    }

    if (failedProxies.length > 0) {
      report.issues.push({
        type: 'error',
        category: 'Failed Proxies',
        message: `${failedProxies.length} FRPC proxies failed to link to FRPS configs`,
        count: failedProxies.length,
        items: failedProxies.slice(0, 5).map((p: any) => `${p.name}: ${p.linkErrorMessage || 'Unknown error'}`)
      });
    }

    // Warning issues
    if (stalePendingProxies.length > 0) {
      report.issues.push({
        type: 'warning',
        category: 'Stale Pending',
        message: `${stalePendingProxies.length} FRPC proxies have been pending for over 1 hour`,
        count: stalePendingProxies.length,
        items: stalePendingProxies.slice(0, 5).map((p: any) => `${p.name} (pending since ${p.lastLinkAttempt})`)
      });
    }

    if (pendingProxies.length > 0) {
      const missingServerInfo = pendingProxies.filter(p => !p.pendingServerAddr || !p.pendingServerPort);
      if (missingServerInfo.length > 0) {
        report.issues.push({
          type: 'warning',
          category: 'Missing Server Info',
          message: `${missingServerInfo.length} pending FRPC proxies are missing server address information`,
          count: missingServerInfo.length,
          items: missingServerInfo.slice(0, 5).map((p: any) => p.name)
        });
      }
    }

    // Check for broken references
    const brokenReferences = frpcProxies.filter(p => p.frpsConfigId && !p.frps);
    if (brokenReferences.length > 0) {
      report.issues.push({
        type: 'error',
        category: 'Broken References',
        message: `${brokenReferences.length} FRPC proxies reference non-existent FRPS configs`,
        count: brokenReferences.length,
        items: brokenReferences.slice(0, 5).map((p: any) => `${p.name} -> ${p.frpsConfigId}`)
      });
    }

    // Check for unused FRPS configs
    const unusedFrpsConfigs = frpsConfigs.filter(config => config.proxies.length === 0);
    if (unusedFrpsConfigs.length > 0) {
      report.issues.push({
        type: 'info',
        category: 'Unused FRPS Configs',
        message: `${unusedFrpsConfigs.length} FRPS configs have no associated FRPC proxies`,
        count: unusedFrpsConfigs.length,
        items: unusedFrpsConfigs.slice(0, 5).map((c: any) => `${c.host.name}:${c.bindPort}`)
      });
    }

    // Info: Overall health
    if (report.summary.healthPercentage === 100) {
      report.issues.push({
        type: 'info',
        category: 'Health Status',
        message: 'All FRPC proxies are properly linked to FRPS configs'
      });
    } else if (report.summary.healthPercentage >= 80) {
      report.issues.push({
        type: 'info',
        category: 'Health Status',
        message: `FRP topology is mostly healthy (${report.summary.healthPercentage}%)`
      });
    } else {
      report.issues.push({
        type: 'warning',
        category: 'Health Status',
        message: `FRP topology health is below 80% (${report.summary.healthPercentage}%)`
      });
    }
  }

  private generateRecommendations(report: ValidationReport): void {
    const hasErrors = report.issues.some(issue => issue.type === 'error');
    const hasWarnings = report.issues.some(issue => issue.type === 'warning');

    if (hasErrors) {
      report.recommendations.push('Run the FRP relationship migration script to fix broken relationships');
      report.recommendations.push('Use: npm run migrate:frp-relationships:dry-run (to preview changes)');
      report.recommendations.push('Then: npm run migrate:frp-relationships (to apply fixes)');
    }

    if (hasWarnings) {
      report.recommendations.push('Consider running FRP dependency resolution to retry pending proxies');
      report.recommendations.push('Use API: POST /api/v1/frp/resolve-dependencies');
    }

    if (report.details.stalePendingProxies > 0) {
      report.recommendations.push('Run FRP healing to retry stale pending proxies');
      report.recommendations.push('Use API: POST /api/v1/frp/heal');
    }

    if (report.summary.healthPercentage < 100) {
      report.recommendations.push('Monitor FRP sync logs for recurring issues');
      report.recommendations.push('Use API: GET /api/v1/frp/logs');
    }

    if (report.recommendations.length === 0) {
      report.recommendations.push('FRP topology is healthy - no action required');
      report.recommendations.push('Consider setting up monitoring for ongoing health checks');
    }
  }

  private printValidationReport(report: ValidationReport): void {
    this.logger.log('\n' + '='.repeat(60));
    this.logger.log('FRP TOPOLOGY VALIDATION REPORT');
    this.logger.log('='.repeat(60));
    
    // Summary
    this.logger.log('SUMMARY:');
    this.logger.log(`  Total FRPS Configs: ${report.summary.totalFrpsConfigs}`);
    this.logger.log(`  Total FRPC Proxies: ${report.summary.totalFrpcProxies}`);
    this.logger.log(`  Healthy Proxies: ${report.summary.healthyProxies}`);
    this.logger.log(`  Unhealthy Proxies: ${report.summary.unhealthyProxies}`);
    this.logger.log(`  Health Percentage: ${report.summary.healthPercentage}%`);

    // Details
    this.logger.log('\nDETAILS:');
    this.logger.log(`  Linked: ${report.details.linkedProxies}`);
    this.logger.log(`  Pending: ${report.details.pendingProxies}`);
    this.logger.log(`  Failed: ${report.details.failedProxies}`);
    this.logger.log(`  Orphaned: ${report.details.orphanedProxies}`);
    this.logger.log(`  Stale Pending: ${report.details.stalePendingProxies}`);

    // Issues
    if (report.issues.length > 0) {
      this.logger.log('\nISSUES:');
      report.issues.forEach((issue, index) => {
        const icon = issue.type === 'error' ? '❌' : issue.type === 'warning' ? '⚠️' : 'ℹ️';
        this.logger.log(`  ${index + 1}. ${icon} [${issue.category}] ${issue.message}`);
        if (issue.items && issue.items.length > 0) {
          issue.items.forEach(item => {
            this.logger.log(`     - ${item}`);
          });
          if (issue.count && issue.count > issue.items.length) {
            this.logger.log(`     ... and ${issue.count - issue.items.length} more`);
          }
        }
      });
    }

    // Recommendations
    if (report.recommendations.length > 0) {
      this.logger.log('\nRECOMMENDATIONS:');
      report.recommendations.forEach((rec, index) => {
        this.logger.log(`  ${index + 1}. ${rec}`);
      });
    }

    this.logger.log('='.repeat(60));
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    console.log(`
FRP Topology Validation Script

Usage:
  npx tsx scripts/validate-frp-topology.ts [options]

Options:
  --help, -h       Show this help message

Examples:
  npx tsx scripts/validate-frp-topology.ts
`);
    process.exit(0);
  }

  const validator = new FrpTopologyValidator();
  
  try {
    const report = await validator.validate();
    
    const hasErrors = report.issues.some(issue => issue.type === 'error');
    const hasWarnings = report.issues.some(issue => issue.type === 'warning');
    
    if (hasErrors) {
      console.log('\n❌ Validation completed with errors. Please review and fix the issues above.');
      process.exit(1);
    } else if (hasWarnings) {
      console.log('\n⚠️ Validation completed with warnings. Consider addressing the issues above.');
      process.exit(0);
    } else {
      console.log('\n✅ Validation completed successfully! FRP topology is healthy.');
      process.exit(0);
    }
  } catch (error) {
    console.error('Validation failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { FrpTopologyValidator, ValidationReport };
