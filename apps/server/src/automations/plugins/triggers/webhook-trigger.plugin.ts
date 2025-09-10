import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult } from '../interfaces';

interface WebhookTriggerData {
  webhookId: string;
  payload: any;
  headers: Record<string, string>;
  source: string;
  timestamp: Date;
}

/**
 * Webhook trigger plugin
 * Triggers automation rules via HTTP webhook calls
 */
@Injectable()
export class WebhookTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'webhook-trigger';
  public readonly name = 'Webhook Trigger';
  public readonly description = 'Triggers automation rules via HTTP webhook calls';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['webhook', 'http', 'external'];
  public readonly triggerType = 'webhook';
  
  /**
   * Evaluate webhook trigger
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    if (!this.isTriggerEnabled(config)) {
      return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
    }
    
    const webhookData = context.metadata?.webhook as WebhookTriggerData;
    if (!webhookData) {
      return this.createTriggerResult(false, { reason: 'No webhook data provided' });
    }
    
    // Validate webhook ID matches configuration
    const expectedWebhookId = this.getConfigValue(config, 'webhookId', null);
    if (expectedWebhookId && webhookData.webhookId !== expectedWebhookId) {
      return this.createTriggerResult(false, { 
        reason: `Webhook ID mismatch. Expected: ${expectedWebhookId}, got: ${webhookData.webhookId}` 
      });
    }
    
    // Validate webhook source if configured
    const allowedSources = this.getConfigValue(config, 'allowedSources', []) as string[];
    if (allowedSources.length > 0 && !allowedSources.includes(webhookData.source)) {
      return this.createTriggerResult(false, { 
        reason: `Source '${webhookData.source}' not in allowed sources: ${allowedSources.join(', ')}` 
      });
    }
    
    // Validate payload conditions if configured
    const payloadConditions = this.getConfigValue(config, 'payloadConditions', {});
    if (!this.validatePayloadConditions(webhookData.payload, payloadConditions)) {
      return this.createTriggerResult(false, { reason: 'Payload conditions not met' });
    }
    
    return this.createTriggerResult(true, {
      reason: 'Webhook trigger conditions met',
      triggerData: {
        webhookId: webhookData.webhookId,
        payload: webhookData.payload,
        headers: webhookData.headers,
        source: webhookData.source,
        receivedAt: webhookData.timestamp
      }
    });
  }
  
  /**
   * Webhook triggers don't have scheduled evaluation times
   */
  public async getNextEvaluationTime(config: TriggerConfig): Promise<Date | null> {
    return null; // Webhook triggers are event-driven
  }
  
  /**
   * Validate webhook trigger configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    const webhookId = config.config.webhookId;
    if (webhookId && typeof webhookId !== 'string') {
      this.logError('webhookId must be a string');
      return false;
    }
    
    const allowedSources = config.config.allowedSources;
    if (allowedSources && !Array.isArray(allowedSources)) {
      this.logError('allowedSources must be an array');
      return false;
    }
    
    const payloadConditions = config.config.payloadConditions;
    if (payloadConditions && typeof payloadConditions !== 'object') {
      this.logError('payloadConditions must be an object');
      return false;
    }
    
    return true;
  }
  
  /**
   * Get trigger configuration schema
   */
  public getTriggerConfigSchema(): Record<string, any> {
    return {
      type: 'object',
      properties: {
        webhookId: {
          type: 'string',
          title: 'Webhook ID',
          description: 'Unique identifier for this webhook endpoint (will be part of the webhook URL)',
          minLength: 1,
          pattern: '^[a-zA-Z0-9_-]+$',
          placeholder: 'my-webhook-id',
          examples: ['github-deploy', 'docker-update', 'alert-handler']
        },
        allowedSources: {
          type: 'array',
          title: 'Allowed Sources',
          description: 'List of allowed source identifiers or IP addresses (empty = allow all)',
          items: {
            type: 'string',
            title: 'Source',
            placeholder: 'github.com or 192.168.1.100'
          },
          default: [],
          examples: [['github.com', 'gitlab.com'], ['192.168.1.0/24'], ['api.example.com']]
        },
        httpMethods: {
          type: 'array',
          title: 'Allowed HTTP Methods',
          description: 'HTTP methods that this webhook accepts',
          items: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
          },
          default: ['POST'],
          examples: [['POST'], ['POST', 'PUT'], ['GET', 'POST']]
        },
        payloadConditions: {
          type: 'object',
          title: 'Payload Conditions',
          description: 'JSON conditions that must be met in the webhook payload (JSONPath supported)',
          additionalProperties: true,
          default: {},
          examples: [
            { 'action': 'push', 'ref': 'refs/heads/main' },
            { 'event_type': 'deployment' },
            { 'status': 'success' }
          ]
        },
        requireValidation: {
          type: 'boolean',
          title: 'Require Signature Validation',
          description: 'Whether to validate webhook signatures (recommended for security)',
          default: false
        },
        secret: {
          type: 'string',
          title: 'Webhook Secret',
          description: 'Secret key for webhook signature validation (required if validation is enabled)',
          format: 'password',
          minLength: 8,
          placeholder: 'Enter a secure secret key'
        },
        timeout: {
          type: 'number',
          title: 'Timeout (seconds)',
          description: 'Maximum time to wait for webhook processing',
          default: 30,
          minimum: 5,
          maximum: 300
        }
      },
      required: ['webhookId'],
      additionalProperties: false
    };
  }
  
  /**
   * Get available trigger conditions
   */
  public getAvailableConditions(): Record<string, any> {
    return {
      webhookReceived: {
        title: 'Webhook Received',
        description: 'Triggered when a matching webhook is received',
        operators: ['equals', 'contains']
      },
      payloadMatches: {
        title: 'Payload Matches',
        description: 'Triggered when webhook payload matches conditions',
        operators: ['equals', 'contains', 'exists']
      }
    };
  }
  
  /**
   * Validate payload conditions
   */
  private validatePayloadConditions(payload: any, conditions: Record<string, any>): boolean {
    if (!conditions || Object.keys(conditions).length === 0) {
      return true; // No conditions to validate
    }
    
    try {
      for (const [path, expectedValue] of Object.entries(conditions)) {
        const actualValue = this.getNestedValue(payload, path);
        
        if (actualValue !== expectedValue) {
          this.logDebug(`Payload condition failed: ${path} = ${actualValue}, expected ${expectedValue}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      this.logError('Error validating payload conditions', error);
      return false;
    }
  }
  
  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, obj);
  }
}