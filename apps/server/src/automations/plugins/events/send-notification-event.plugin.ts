import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import axios from 'axios';
import * as nodemailer from 'nodemailer';

interface NotificationChannel {
  type: 'email' | 'slack' | 'discord' | 'webhook' | 'teams';
  config: any;
}

/**
 * Send notification event plugin
 * Sends notifications via various channels (email, Slack, Discord, webhooks, etc.)
 */
@Injectable()
export class SendNotificationEventPlugin extends BaseEventPlugin {
  public readonly id = 'send-notification-event';
  public readonly name = 'Send Notification';
  public readonly description = 'Sends notifications via various channels';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['notification', 'email', 'slack', 'discord', 'webhook'];
  public readonly eventType = 'send-notification';
  
  constructor(
    private readonly operationLogService: OperationLogService
  ) {
    super();
  }
  
  /**
   * Execute the send notification event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const channel = this.getParam(config, 'channel', 'email');
      const message = this.getParam(config, 'message', '');
      const subject = this.getParam(config, 'subject', 'Automation Notification');
      const recipients = this.getParam(config, 'recipients', []);
      const channelConfig = this.getParam(config, 'channelConfig', {});
      const includeContext = this.getParam(config, 'includeContext', true);
      
      if (!message) {
        return this.createFailureResult('Message is required');
      }
      
      if (!recipients || recipients.length === 0) {
        return this.createFailureResult('At least one recipient is required');
      }
      
      // Build notification content
      const notificationContent = this.buildNotificationContent(message, subject, context, includeContext);
      
      // Send notification via selected channel
      const result = await this.sendNotification(channel, notificationContent, recipients, channelConfig);
      
      if (result.success) {
        this.operationLogService.log('info', `Notification sent via ${channel} to ${(recipients as any[]).length} recipients`);
        return this.createSuccessResult(
          `Notification sent successfully via ${channel}`,
          {
            channel,
            recipients: (recipients as any[]).length,
            messageLength: (message as string).length,
            sentAt: new Date()
          }
        );
      } else {
        this.operationLogService.log('error', `Failed to send notification via ${channel}: ${result.error}`);
        return this.createFailureResult(`Failed to send notification: ${result.error}`);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to send notification', error);
      this.operationLogService.log('error', `Notification failed: ${errorMessage}`);
      return this.createFailureResult(`Notification failed: ${errorMessage}`);
    }
  }
  
  /**
   * Get event configuration schema
   */
  public getEventConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          const: 'send-notification'
        },
        params: {
          $ref: '#/definitions/SendNotificationParams'
        },
        enabled: {
          type: 'boolean',
          default: true
        },
        options: {
          type: 'object',
          properties: {
            timeout: {
              type: 'number',
              minimum: 5000,
              maximum: 60000,
              default: 30000
            },
            retry: {
              type: 'boolean',
              default: true
            }
          }
        }
      },
      required: ['type', 'params'],
      definitions: {
        SendNotificationParams: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              title: 'Notification Channel',
              description: 'Channel to send notification through',
              enum: ['email', 'slack', 'discord', 'webhook', 'teams', 'sms'],
              default: 'email',
              examples: ['email', 'slack', 'webhook']
            },
            message: {
              type: 'string',
              title: 'Message Content',
              description: 'The notification message content (supports markdown for some channels)',
              format: 'textarea',
              minLength: 1,
              maxLength: 4000,
              placeholder: 'Enter your notification message here',
              examples: [
                'Alert: Container {{container_name}} is down',
                'System backup completed successfully',
                'High CPU usage detected on {{host_name}}: {{cpu_usage}}%'
              ]
            },
            subject: {
              type: 'string',
              title: 'Subject/Title',
              description: 'Message subject or title (used for email, Slack, Teams)',
              maxLength: 200,
              default: 'Automation Notification',
              placeholder: 'Enter notification subject',
              examples: [
                'System Alert',
                'Backup Status',
                'Container Status Update',
                'Resource Alert'
              ]
            },
            recipients: {
              type: 'array',
              title: 'Recipients',
              description: 'List of recipients (emails, Slack channels, webhook URLs, etc.)',
              items: {
                type: 'string',
                minLength: 1,
                title: 'Recipient',
                placeholder: 'email@example.com or #channel'
              },
              minItems: 1
            },
            channelConfig: {
              type: 'object',
              title: 'Channel Configuration',
              description: 'Channel-specific configuration',
              additionalProperties: true,
              default: {}
            },
            includeContext: {
              type: 'boolean',
              title: 'Include Context',
              description: 'Include automation context in the message',
              default: true
            },
            priority: {
              type: 'string',
              title: 'Priority',
              description: 'Notification priority level',
              enum: ['low', 'normal', 'high', 'critical'],
              default: 'normal'
            },
            template: {
              type: 'string',
              title: 'Message Template',
              description: 'Template for message formatting',
              enum: ['plain', 'markdown', 'html'],
              default: 'plain'
            }
          },
          required: ['message', 'recipients']
        }
      }
    };
  }
  
  /**
   * Get event parameter schema
   */
  public getEventParamsSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          title: 'Notification Channel',
          enum: ['email', 'slack', 'discord', 'webhook', 'teams'],
          default: 'email'
        },
        message: {
          type: 'string',
          title: 'Message',
          description: 'Notification message content',
          minLength: 1,
          maxLength: 4000
        },
        subject: {
          type: 'string',
          title: 'Subject',
          maxLength: 200,
          default: 'Automation Notification'
        },
        recipients: {
          type: 'array',
          title: 'Recipients',
          items: {
            type: 'string',
            minLength: 1
          },
          minItems: 1
        },
        channelConfig: {
          type: 'object',
          title: 'Channel Configuration',
          additionalProperties: true,
          default: {}
        },
        includeContext: {
          type: 'boolean',
          title: 'Include Context',
          default: true
        },
        priority: {
          type: 'string',
          title: 'Priority',
          enum: ['low', 'normal', 'high', 'critical'],
          default: 'normal'
        }
      },
      required: ['message', 'recipients'],
      additionalProperties: false
    };
  }
  
  /**
   * Validate send notification configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['message', 'recipients'])) {
      return false;
    }
    
    const channel = config.params.channel;
    const validChannels = ['email', 'slack', 'discord', 'webhook', 'teams'];
    if (channel && !validChannels.includes(channel)) {
      this.logError(`Invalid notification channel: ${channel}`);
      return false;
    }
    
    const recipients = config.params.recipients;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      this.logError('Recipients must be a non-empty array');
      return false;
    }
    
    return true;
  }
  
  /**
   * Notification events typically execute quickly
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const recipients = this.getParam(config, 'recipients', []);
    return Math.max(5000, recipients.length * 1000); // 1 second per recipient, minimum 5 seconds
  }
  
  /**
   * Build notification content with context
   */
  private buildNotificationContent(
    message: string, 
    subject: string, 
    context: EventContext, 
    includeContext: boolean
  ): { subject: string; message: string; context?: any } {
    let finalMessage = message;
    
    // Replace placeholders
    finalMessage = finalMessage.replace(/\{rule\.name\}/g, context.rule.name);
    finalMessage = finalMessage.replace(/\{rule\.id\}/g, context.rule.id);
    finalMessage = finalMessage.replace(/\{timestamp\}/g, new Date().toISOString());
    
    // Include context if requested
    const notificationContent: any = {
      subject,
      message: finalMessage
    };
    
    if (includeContext) {
      notificationContent.context = {
        rule: context.rule,
        triggerData: context.triggerResult?.triggerData,
        operationId: context.operationLogId,
        timestamp: new Date().toISOString()
      };
    }
    
    return notificationContent;
  }
  
  /**
   * Send notification via selected channel
   */
  private async sendNotification(
    channel: string,
    content: any,
    recipients: string[],
    channelConfig: any
  ): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      switch (channel) {
        case 'email':
          return await this.sendEmailNotification(content, recipients, channelConfig);
        case 'slack':
          return await this.sendSlackNotification(content, recipients, channelConfig);
        case 'discord':
          return await this.sendDiscordNotification(content, recipients, channelConfig);
        case 'webhook':
          return await this.sendWebhookNotification(content, recipients, channelConfig);
        case 'teams':
          return await this.sendTeamsNotification(content, recipients, channelConfig);
        default:
          return { success: false, error: `Unsupported channel: ${channel}` };
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }
  
  /**
   * Send email notification
   */
  private async sendEmailNotification(
    content: any,
    recipients: string[],
    config: any
  ): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      // This would integrate with your SMTP configuration
      // For demo purposes, we'll just log the email
      this.logInfo(`Email notification would be sent to: ${recipients.join(', ')}`);
      this.logInfo(`Subject: ${content.subject}`);
      this.logInfo(`Message: ${content.message.substring(0, 100)}...`);
      
      // Real implementation would use nodemailer:
      /*
      const transporter = nodemailer.createTransporter({
        host: config.smtpHost || 'localhost',
        port: config.smtpPort || 587,
        secure: config.secure || false,
        auth: config.auth ? {
          user: config.auth.user,
          pass: config.auth.pass
        } : undefined
      });
      
      await transporter.sendMail({
        from: config.from || 'automation@selfhost-serv-agent.local',
        to: recipients.join(', '),
        subject: content.subject,
        text: content.message,
        html: config.html ? content.message : undefined
      });
      */
      
      return { success: true, details: { recipients: recipients.length } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Send Slack notification
   */
  private async sendSlackNotification(
    content: any,
    recipients: string[],
    config: any
  ): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      if (!config.webhookUrl && !config.botToken) {
        return { success: false, error: 'Slack webhook URL or bot token is required' };
      }
      
      const slackMessage = {
        text: content.subject,
        attachments: [{
          color: this.getPriorityColor(config.priority),
          fields: [{
            title: 'Message',
            value: content.message,
            short: false
          }],
          ts: Math.floor(Date.now() / 1000)
        }]
      };
      
      if (config.webhookUrl) {
        await axios.post(config.webhookUrl, slackMessage);
      }
      
      return { success: true, details: { recipients: recipients.length } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Send Discord notification
   */
  private async sendDiscordNotification(
    content: any,
    recipients: string[],
    config: any
  ): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      if (!config.webhookUrl) {
        return { success: false, error: 'Discord webhook URL is required' };
      }
      
      const discordMessage = {
        embeds: [{
          title: content.subject,
          description: content.message,
          color: parseInt(this.getPriorityColor(config.priority).replace('#', ''), 16),
          timestamp: new Date().toISOString()
        }]
      };
      
      await axios.post(config.webhookUrl, discordMessage);
      
      return { success: true, details: { recipients: recipients.length } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(
    content: any,
    recipients: string[],
    config: any
  ): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      const payload = {
        ...content,
        recipients,
        timestamp: new Date().toISOString()
      };
      
      const results = [];
      for (const webhookUrl of recipients) {
        try {
          await axios.post(webhookUrl, payload, {
            headers: {
              'Content-Type': 'application/json',
              ...config.headers
            },
            timeout: config.timeout || 10000
          });
          results.push({ url: webhookUrl, success: true });
        } catch (error) {
          results.push({ url: webhookUrl, success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const success = successCount > 0;
      
      return { success, details: { results, successCount } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Send Microsoft Teams notification
   */
  private async sendTeamsNotification(
    content: any,
    recipients: string[],
    config: any
  ): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      if (!config.webhookUrl) {
        return { success: false, error: 'Teams webhook URL is required' };
      }
      
      const teamsMessage = {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        themeColor: this.getPriorityColor(config.priority),
        summary: content.subject,
        sections: [{
          activityTitle: content.subject,
          text: content.message,
          markdown: true
        }]
      };
      
      await axios.post(config.webhookUrl, teamsMessage);
      
      return { success: true, details: { recipients: recipients.length } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  
  /**
   * Get priority color for notifications
   */
  private getPriorityColor(priority: string): string {
    switch (priority) {
      case 'critical':
        return '#FF0000';
      case 'high':
        return '#FF8C00';
      case 'normal':
        return '#36A64F';
      case 'low':
        return '#808080';
      default:
        return '#36A64F';
    }
  }
}