import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ConnectivityAutomationTemplate {
  name: string;
  description: string;
  ruleJson: any;
  isEnabled: boolean;
}

@Injectable()
export class ConnectivityAutomationTemplates {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get all predefined connectivity automation templates
   */
  getTemplates(): ConnectivityAutomationTemplate[] {
    return [
      {
        name: 'Host Offline Alert',
        description: 'Send notification when a host goes offline',
        isEnabled: false,
        ruleJson: {
          conditions: {
            all: [
              {
                fact: 'hostStatus',
                operator: 'equal',
                value: 'OFFLINE'
              }
            ]
          },
          event: {
            type: 'LOG_MESSAGE',
            params: {
              level: 'warn',
              message: 'Host {{hostName}} ({{hostId}}) has gone offline. Error: {{errorMessage}}'
            }
          }
        }
      },
      {
        name: 'Host Back Online Notification',
        description: 'Send notification when a host comes back online',
        isEnabled: false,
        ruleJson: {
          conditions: {
            all: [
              {
                fact: 'hostStatus',
                operator: 'equal',
                value: 'ONLINE'
              },
              {
                fact: 'previousHostStatus',
                operator: 'equal',
                value: 'OFFLINE'
              }
            ]
          },
          event: {
            type: 'LOG_MESSAGE',
            params: {
              level: 'info',
              message: 'Host {{hostName}} ({{hostId}}) is back online. Response time: {{responseTime}}ms'
            }
          }
        }
      },
      {
        name: 'Critical Host Offline Alert',
        description: 'Send urgent alert when a critical host (tagged as "critical") goes offline',
        isEnabled: false,
        ruleJson: {
          conditions: {
            all: [
              {
                fact: 'hostStatus',
                operator: 'equal',
                value: 'OFFLINE'
              },
              {
                fact: 'hostTags',
                operator: 'contains',
                value: 'critical'
              }
            ]
          },
          event: {
            type: 'WEBHOOK_CALL',
            params: {
              url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK',
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: {
                text: '🚨 CRITICAL HOST OFFLINE: {{hostName}} ({{hostAddress}}) is no longer reachable!',
                channel: '#alerts',
                username: 'SelfHost Monitor'
              }
            }
          }
        }
      },
      {
        name: 'High Response Time Alert',
        description: 'Alert when host response time exceeds threshold',
        isEnabled: false,
        ruleJson: {
          conditions: {
            all: [
              {
                fact: 'hostStatus',
                operator: 'equal',
                value: 'ONLINE'
              },
              {
                fact: 'responseTime',
                operator: 'greaterThan',
                value: 5000
              }
            ]
          },
          event: {
            type: 'LOG_MESSAGE',
            params: {
              level: 'warn',
              message: 'Host {{hostName}} has high response time: {{responseTime}}ms (threshold: 5000ms)'
            }
          }
        }
      },
      {
        name: 'Multiple Hosts Offline Alert',
        description: 'Alert when multiple hosts are offline simultaneously',
        isEnabled: false,
        ruleJson: {
          conditions: {
            all: [
              {
                fact: 'offlineHostCount',
                operator: 'greaterThanInclusive',
                value: 3
              }
            ]
          },
          event: {
            type: 'LOG_MESSAGE',
            params: {
              level: 'error',
              message: 'INFRASTRUCTURE ALERT: {{offlineHostCount}} hosts are currently offline. This may indicate a network issue.'
            }
          }
        }
      },
      {
        name: 'Host Connectivity Recovery Script',
        description: 'Execute recovery script when a host comes back online after being offline',
        isEnabled: false,
        ruleJson: {
          conditions: {
            all: [
              {
                fact: 'hostStatus',
                operator: 'equal',
                value: 'ONLINE'
              },
              {
                fact: 'previousHostStatus',
                operator: 'equal',
                value: 'OFFLINE'
              },
              {
                fact: 'hostTags',
                operator: 'contains',
                value: 'auto-recovery'
              }
            ]
          },
          event: {
            type: 'EXEC_COMMAND',
            params: {
              hostId: '{{hostId}}',
              command: 'systemctl restart docker && docker system prune -f',
              description: 'Auto-recovery: Restart Docker and clean up system after host reconnection'
            }
          }
        }
      },
      {
        name: 'Daily Connectivity Report',
        description: 'Generate daily connectivity status report',
        isEnabled: false,
        ruleJson: {
          conditions: {
            all: [
              {
                fact: 'currentTime',
                operator: 'matchesCron',
                value: '0 9 * * *'
              }
            ]
          },
          event: {
            type: 'LOG_MESSAGE',
            params: {
              level: 'info',
              message: 'Daily Connectivity Report: {{totalHosts}} total hosts, {{onlineHosts}} online, {{offlineHosts}} offline. Average response time: {{averageResponseTime}}ms'
            }
          }
        }
      }
    ];
  }

  /**
   * Create automation rules from templates
   */
  async createRulesFromTemplates(templateNames: string[]): Promise<void> {
    const templates = this.getTemplates();
    const selectedTemplates = templates.filter(t => templateNames.includes(t.name));

    for (const template of selectedTemplates) {
      // Check if rule already exists
      const existingRule = await this.prisma.automationRule.findFirst({
        where: { name: template.name }
      });

      if (!existingRule) {
        await this.prisma.automationRule.create({
          data: {
            name: template.name,
            description: template.description,
            isEnabled: template.isEnabled,
            ruleJson: template.ruleJson,
          }
        });
      }
    }
  }

  /**
   * Create all connectivity automation templates
   */
  async createAllTemplates(): Promise<void> {
    const templates = this.getTemplates();
    await this.createRulesFromTemplates(templates.map(t => t.name));
  }

  /**
   * Get connectivity automation rule suggestions based on current system state
   */
  async getSuggestions(): Promise<{
    recommended: string[];
    reasons: Record<string, string>;
  }> {
    const recommendations: string[] = [];
    const reasons: Record<string, string> = {};

    // Check if there are any hosts
    const hostCount = await this.prisma.host.count();
    
    if (hostCount > 0) {
      recommendations.push('Host Offline Alert');
      reasons['Host Offline Alert'] = 'You have hosts configured. Get notified when they go offline.';
      
      recommendations.push('Host Back Online Notification');
      reasons['Host Back Online Notification'] = 'Get notified when hosts recover from offline state.';
    }

    // Check if there are critical hosts
    const criticalHosts = await this.prisma.host.count({
      where: {
        tags: {
          has: 'critical'
        }
      }
    });

    if (criticalHosts > 0) {
      recommendations.push('Critical Host Offline Alert');
      reasons['Critical Host Offline Alert'] = `You have ${criticalHosts} critical hosts. Get urgent alerts when they go offline.`;
    }

    // Check if there are hosts with auto-recovery tag
    const autoRecoveryHosts = await this.prisma.host.count({
      where: {
        tags: {
          has: 'auto-recovery'
        }
      }
    });

    if (autoRecoveryHosts > 0) {
      recommendations.push('Host Connectivity Recovery Script');
      reasons['Host Connectivity Recovery Script'] = `You have ${autoRecoveryHosts} hosts tagged for auto-recovery.`;
    }

    if (hostCount >= 3) {
      recommendations.push('Multiple Hosts Offline Alert');
      reasons['Multiple Hosts Offline Alert'] = 'With multiple hosts, get alerted about potential infrastructure issues.';
      
      recommendations.push('Daily Connectivity Report');
      reasons['Daily Connectivity Report'] = 'Get daily summaries of your infrastructure connectivity status.';
    }

    return { recommended: recommendations, reasons };
  }
}
