import { Injectable } from '@nestjs/common';
import { BaseTriggerPlugin } from '../base';
import { TriggerConfig, TriggerContext, TriggerResult } from '../interfaces';
import axios, { AxiosResponse } from 'axios';

interface HealthCheckResult {
  url: string;
  status: number;
  responseTime: number;
  isHealthy: boolean;
  error?: string;
  body?: string;
  headers?: Record<string, string>;
}

/**
 * HTTP Health Check trigger plugin
 * Triggers based on HTTP endpoint health status (up/down, response time, status codes)
 */
@Injectable()
export class HttpHealthCheckTriggerPlugin extends BaseTriggerPlugin {
  public readonly id = 'http-health-check-trigger';
  public readonly name = 'HTTP Health Check Trigger';
  public readonly description = 'Triggers based on HTTP endpoint health status';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['http', 'health', 'monitoring', 'uptime'];
  public readonly triggerType = 'http-health-check';
  
  /**
   * Evaluate HTTP health check trigger
   */
  public async evaluate(config: TriggerConfig, context: TriggerContext): Promise<TriggerResult> {
    try {
      if (!this.isTriggerEnabled(config)) {
        return this.createTriggerResult(false, { reason: 'Trigger is disabled' });
      }
      
      const url = this.getConfigValue(config, 'url', '');
      const _method = this.getConfigValue(config, 'method', 'GET');
      const expectedStatus = this.getConfigValue(config, 'expectedStatus', [200]);
      const maxResponseTime = this.getConfigValue(config, 'maxResponseTime', 5000);
      const triggerOn = this.getConfigValue(config, 'triggerOn', 'unhealthy') as 'healthy' | 'unhealthy';
      const _timeout = this.getConfigValue(config, 'timeout', 10000);
      
      if (!url) {
        return this.createTriggerResult(false, { reason: 'URL is required' });
      }
      
      const healthResult = await this.performHealthCheck(config);
      
      const isHealthy = healthResult.isHealthy;
      const shouldTrigger = (triggerOn === 'healthy' && isHealthy) || 
                           (triggerOn === 'unhealthy' && !isHealthy);
      
      return this.createTriggerResult(shouldTrigger, {
        reason: this.buildTriggerReason(healthResult, triggerOn, expectedStatus, maxResponseTime),
        triggerData: {
          ...healthResult,
          triggerOn,
          expectedStatus,
          maxResponseTime,
          evaluationTime: context.timestamp
        }
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Error evaluating HTTP health check trigger', error);
      return this.createTriggerResult(false, {
        reason: `HTTP health check evaluation error: ${errorMessage}`
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
        url: {
          type: 'string',
          title: 'Health Check URL',
          description: 'HTTP endpoint URL to monitor for health status',
          format: 'uri',
          minLength: 1,
          placeholder: 'https://example.com/health',
          examples: [
            'https://example.com/health',
            'http://localhost:3000/api/status',
            'https://api.service.com/ping',
            'http://nginx/health',
            'https://app.domain.com/api/health'
          ]
        },
        method: {
          type: 'string',
          title: 'HTTP Method',
          description: 'HTTP method to use for the health check request',
          enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
          default: 'GET',
          examples: ['GET', 'POST', 'HEAD']
        },
        expectedStatus: {
          type: 'array',
          title: 'Expected Status Codes',
          description: 'HTTP status codes that indicate a healthy service',
          items: {
            type: 'integer',
            minimum: 100,
            maximum: 599,
            title: 'Status Code'
          },
          default: [200],
          examples: [
            [200],
            [200, 201, 204],
            [200, 302],
            [200, 201, 202, 204]
          ]
        },
        maxResponseTime: {
          type: 'number',
          title: 'Max Response Time (ms)',
          description: 'Maximum acceptable response time in milliseconds',
          minimum: 100,
          maximum: 60000,
          default: 5000,
          examples: [1000, 3000, 5000, 10000]
        },
        triggerOn: {
          type: 'string',
          title: 'Trigger Condition',
          description: 'When should this health check trigger the automation?',
          enum: ['healthy', 'unhealthy'],
          default: 'unhealthy',
          examples: ['unhealthy', 'healthy']
        },
        timeout: {
          type: 'number',
          title: 'Request Timeout (ms)',
          description: 'Maximum time to wait for HTTP response',
          minimum: 1000,
          maximum: 60000,
          default: 10000,
          examples: [5000, 10000, 15000, 30000]
        },
        headers: {
          type: 'object',
          title: 'Custom Headers',
          description: 'Additional HTTP headers to send with the request',
          additionalProperties: {
            type: 'string'
          },
          default: {},
          examples: [
            { 'Authorization': 'Bearer token123' },
            { 'User-Agent': 'HealthChecker/1.0', 'Accept': 'application/json' },
            { 'X-API-Key': 'your-api-key' }
          ]
        },
        body: {
          type: 'string',
          title: 'Request Body',
          description: 'Request body content for POST/PUT requests (JSON format)',
          format: 'textarea',
          placeholder: '{"ping": "health-check"}',
          examples: [
            '{"ping": "health-check"}',
            '{"service": "status"}',
            'ping'
          ]
        },
        followRedirects: {
          type: 'boolean',
          title: 'Follow Redirects',
          description: 'Whether to automatically follow HTTP redirects (3xx responses)',
          default: true
        },
        retryAttempts: {
          type: 'number',
          title: 'Retry Attempts',
          description: 'Number of retry attempts on failure',
          minimum: 0,
          maximum: 5,
          default: 1,
          examples: [0, 1, 2, 3]
        },
        validateSsl: {
          type: 'boolean',
          title: 'Validate SSL',
          description: 'Whether to validate SSL certificates',
          default: true
        },
        checkInterval: {
          type: 'number',
          title: 'Check Interval (seconds)',
          description: 'How often to perform the health check',
          minimum: 10,
          maximum: 3600,
          default: 60
        },
        responseChecks: {
          type: 'object',
          title: 'Response Validation',
          description: 'Additional checks on the response',
          properties: {
            containsText: {
              type: 'string',
              title: 'Contains Text',
              description: 'Text that must be present in the response body'
            },
            jsonPath: {
              type: 'string',
              title: 'JSON Path Check',
              description: 'JSON path expression to validate (e.g., "$.status")'
            },
            expectedValue: {
              type: 'string',
              title: 'Expected Value',
              description: 'Expected value for JSON path check'
            }
          }
        }
      },
      required: ['url'],
      additionalProperties: false
    };
  }
  
  /**
   * Get next evaluation time based on check interval
   */
  public async getNextEvaluationTime(config: TriggerConfig): Promise<Date | null> {
    const checkInterval = this.getConfigValue(config, 'checkInterval', 60);
    return new Date(Date.now() + (checkInterval * 1000));
  }
  
  /**
   * Validate HTTP health check trigger configuration
   */
  protected async validateCustomConfig(config: TriggerConfig): Promise<boolean> {
    if (!this.validateRequiredFields(config, ['url'])) {
      return false;
    }
    
    const url = config.config.url;
    try {
      new URL(url);
    } catch (error) {
      this.logError(`Invalid URL: ${url}`);
      return false;
    }
    
    const method = config.config.method;
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
    if (method && !validMethods.includes(method)) {
      this.logError(`Invalid HTTP method: ${method}`);
      return false;
    }
    
    const expectedStatus = config.config.expectedStatus;
    if (expectedStatus && Array.isArray(expectedStatus)) {
      for (const status of expectedStatus) {
        if (typeof status !== 'number' || status < 100 || status > 599) {
          this.logError(`Invalid status code: ${status}`);
          return false;
        }
      }
    }
    
    return true;
  }
  
  /**
   * Get available trigger conditions
   */
  public getAvailableConditions(): Record<string, any> {
    return {
      serviceHealthy: {
        title: 'Service Healthy',
        description: 'Triggered when service is healthy/responding',
        operators: ['equals', 'not_equals']
      },
      responseTime: {
        title: 'Response Time',
        description: 'Triggered based on response time thresholds',
        operators: ['greater_than', 'less_than']
      },
      statusCode: {
        title: 'HTTP Status Code',
        description: 'Triggered based on HTTP status codes',
        operators: ['equals', 'in', 'not_in']
      }
    };
  }
  
  /**
   * Perform HTTP health check
   */
  private async performHealthCheck(config: TriggerConfig): Promise<HealthCheckResult> {
    const url = this.getConfigValue(config, 'url', '');
    const method = this.getConfigValue(config, 'method', 'GET');
    const expectedStatus = this.getConfigValue(config, 'expectedStatus', [200]);
    const maxResponseTime = this.getConfigValue(config, 'maxResponseTime', 5000);
    const timeout = this.getConfigValue(config, 'timeout', 10000);
    const headers = this.getConfigValue(config, 'headers', {});
    const body = this.getConfigValue(config, 'body', undefined);
    const followRedirects = this.getConfigValue(config, 'followRedirects', true);
    const validateSsl = this.getConfigValue(config, 'validateSsl', true);
    const responseChecks = this.getConfigValue(config, 'responseChecks', {});
    
    const startTime = Date.now();
    
    try {
      const response: AxiosResponse = await axios({
        method: method.toLowerCase() as any,
        url,
        headers,
        data: body,
        timeout,
        maxRedirects: followRedirects ? 5 : 0,
        validateStatus: () => true, // Don't throw on any status code
        httpsAgent: validateSsl ? undefined : new (require('https').Agent)({
          rejectUnauthorized: false
        })
      });
      
      const responseTime = Date.now() - startTime;
      const statusOk = expectedStatus.includes(response.status);
      const responseTimeOk = responseTime <= maxResponseTime;
      
      // Additional response checks
      const responseBodyOk = this.validateResponseBody(response.data, responseChecks);
      
      const isHealthy = statusOk && responseTimeOk && responseBodyOk;
      
      return {
        url,
        status: response.status,
        responseTime,
        isHealthy,
        body: typeof response.data === 'string' ? response.data.substring(0, 1000) : JSON.stringify(response.data).substring(0, 1000),
        headers: response.headers as Record<string, string>
      };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        url,
        status: 0,
        responseTime,
        isHealthy: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
  
  /**
   * Validate response body based on checks
   */
  private validateResponseBody(responseData: any, checks: any): boolean {
    if (!checks || Object.keys(checks).length === 0) {
      return true;
    }
    
    try {
      // Check for text content
      if (checks.containsText) {
        const bodyText = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        if (!bodyText.includes(checks.containsText)) {
          return false;
        }
      }
      
      // Check JSON path
      if (checks.jsonPath && checks.expectedValue) {
        if (typeof responseData === 'object') {
          const value = this.getJsonPathValue(responseData, checks.jsonPath);
          if (value !== checks.expectedValue) {
            return false;
          }
        }
      }
      
      return true;
    } catch (error) {
      this.logError('Error validating response body', error);
      return false;
    }
  }
  
  /**
   * Simple JSON path value extraction
   */
  private getJsonPathValue(obj: any, path: string): any {
    try {
      // Simple implementation for basic JSON paths like "$.status" or "$.data.health"
      const cleanPath = path.replace(/^\$\./, '');
      return cleanPath.split('.').reduce((current, key) => current && current[key], obj);
    } catch (error) {
      return undefined;
    }
  }
  
  /**
   * Build human-readable trigger reason
   */
  private buildTriggerReason(
    result: HealthCheckResult, 
    triggerOn: string, 
    expectedStatus: number[], 
    maxResponseTime: number
  ): string {
    const healthStatus = result.isHealthy ? 'healthy' : 'unhealthy';
    const shouldTrigger = (triggerOn === 'healthy' && result.isHealthy) || 
                         (triggerOn === 'unhealthy' && !result.isHealthy);
    
    if (shouldTrigger) {
      if (result.isHealthy) {
        return `Service is healthy: status ${result.status}, response time ${result.responseTime}ms`;
      } else {
        const reasons = [];
        if (!expectedStatus.includes(result.status)) {
          reasons.push(`status ${result.status} (expected ${expectedStatus.join(' or ')})`);
        }
        if (result.responseTime > maxResponseTime) {
          reasons.push(`slow response ${result.responseTime}ms (max ${maxResponseTime}ms)`);
        }
        if (result.error) {
          reasons.push(`error: ${result.error}`);
        }
        return `Service is unhealthy: ${reasons.join(', ')}`;
      }
    } else {
      return `Service is ${healthStatus} but trigger is set to ${triggerOn}`;
    }
  }
}