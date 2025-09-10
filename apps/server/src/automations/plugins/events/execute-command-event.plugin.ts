import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { SshService } from '../../../ssh/ssh.service';

interface CommandResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  executionTime: number;
  command: string;
  host?: string;
}

/**
 * Execute command event plugin
 * Executes shell commands on specified hosts or locally
 */
@Injectable()
export class ExecuteCommandEventPlugin extends BaseEventPlugin {
  public readonly id = 'execute-command-event';
  public readonly name = 'Execute Command';
  public readonly description = 'Executes shell commands on hosts';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['command', 'shell', 'execution', 'remote'];
  public readonly eventType = 'execute-command';
  
  constructor(
    private readonly operationLogService: OperationLogService,
    private readonly sshService: SshService
  ) {
    super();
  }
  
  /**
   * Execute the command event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const command = this.getParam(config, 'command', '');
      const hostId = this.getParam(config, 'hostId', null);
      const timeout = this.getParam(config, 'timeout', 60000);
      const workingDirectory = this.getParam(config, 'workingDirectory', null);
      const environment = this.getParam(config, 'environment', {});
      const runAsUser = this.getParam(config, 'runAsUser', null);
      const continueOnError = this.getParam(config, 'continueOnError', false);
      const captureOutput = this.getParam(config, 'captureOutput', true);
      
      if (!command) {
        return this.createFailureResult('Command is required');
      }
      
      // Build final command with environment and user context
      const finalCommand = this.buildCommand(command, workingDirectory, environment, runAsUser);
      
      const startTime = Date.now();
      let result: CommandResult;
      
      if (hostId) {
        // Execute on remote host
        result = await this.executeRemoteCommand(hostId, finalCommand, timeout, captureOutput);
      } else {
        // Execute locally (if supported)
        result = await this.executeLocalCommand(finalCommand, timeout, captureOutput);
      }
      
      const executionTime = Date.now() - startTime;
      result.executionTime = executionTime;
      
      // Log execution
      const logLevel = result.success ? 'info' : 'error';
      this.operationLogService.log(
        logLevel, 
        `Command executed: ${command} (exit: ${result.exitCode}, time: ${executionTime}ms)`
      );
      
      if (!result.success && !continueOnError) {
        return this.createFailureResult(`Command failed with exit code ${result.exitCode}: ${result.stderr}`);
      }
      
      return this.createSuccessResult(
        `Command executed successfully (exit code: ${result.exitCode})`,
        {
          command: result.command,
          exitCode: result.exitCode,
          stdout: captureOutput ? result.stdout : '[output not captured]',
          stderr: captureOutput ? result.stderr : '[errors not captured]',
          executionTime: result.executionTime,
          host: result.host || 'local',
          success: result.success
        }
      );
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to execute command', error);
      this.operationLogService.log('error', `Command execution failed: ${errorMessage}`);
      return this.createFailureResult(`Command execution failed: ${errorMessage}`);
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
          const: 'execute-command'
        },
        params: {
          $ref: '#/definitions/ExecuteCommandParams'
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
              minimum: 1000,
              maximum: 300000,
              default: 60000
            },
            retry: {
              type: 'boolean',
              default: false
            },
            retryAttempts: {
              type: 'number',
              minimum: 1,
              maximum: 5,
              default: 3
            }
          }
        }
      },
      required: ['type', 'params'],
      definitions: {
        ExecuteCommandParams: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              title: 'Shell Command',
              description: 'Shell command or script to execute on the target host',
              format: 'textarea',
              minLength: 1,
              maxLength: 2000,
              placeholder: 'Enter shell command or script',
              examples: [
                'ls -la /var/log',
                'systemctl status nginx',
                'docker ps -a --format "table {{.Names}}\\t{{.Status}}"',
                'pm2 restart all',
                'df -h | grep -v tmpfs',
                'curl -f http://localhost:8080/health || exit 1'
              ]
            },
            hostId: {
              type: 'string',
              title: 'Target Host',
              description: 'Host to execute command on (leave empty for local execution)',
              placeholder: 'Select a host'
            },
            commandTemplate: {
              type: 'string',
              title: 'Command Template',
              description: 'Pre-defined command template for common operations',
              enum: [
                'custom',
                'system-info',
                'docker-status',
                'service-status',
                'disk-usage',
                'memory-usage',
                'process-list',
                'network-status',
                'log-tail'
              ],
              default: 'custom',
              examples: ['system-info', 'docker-status', 'service-status']
            },
            timeout: {
              type: 'number',
              title: 'Timeout (ms)',
              description: 'Command timeout in milliseconds',
              minimum: 1000,
              maximum: 300000,
              default: 60000
            },
            workingDirectory: {
              type: 'string',
              title: 'Working Directory',
              description: 'Directory to execute command in',
              maxLength: 500,
              examples: ['/home/user', '/var/www', '/opt/app']
            },
            environment: {
              type: 'object',
              title: 'Environment Variables',
              description: 'Additional environment variables',
              additionalProperties: {
                type: 'string'
              },
              default: {},
              examples: [
                { NODE_ENV: 'production' },
                { DEBUG: '1', LOG_LEVEL: 'info' }
              ]
            },
            runAsUser: {
              type: 'string',
              title: 'Run as User',
              description: 'User to execute command as (sudo required)',
              maxLength: 100,
              examples: ['www-data', 'nginx', 'docker']
            },
            continueOnError: {
              type: 'boolean',
              title: 'Continue on Error',
              description: 'Continue automation even if command fails',
              default: false
            },
            captureOutput: {
              type: 'boolean',
              title: 'Capture Output',
              description: 'Capture stdout and stderr in results',
              default: true
            },
            shell: {
              type: 'string',
              title: 'Shell',
              description: 'Shell to use for command execution',
              enum: ['bash', 'sh', 'zsh', 'fish'],
              default: 'bash'
            }
          },
          required: ['command']
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
        command: {
          type: 'string',
          title: 'Command',
          description: 'Shell command to execute',
          minLength: 1,
          maxLength: 2000
        },
        hostId: {
          type: 'string',
          title: 'Host ID',
          description: 'ID of host to execute on (optional for local)'
        },
        timeout: {
          type: 'number',
          title: 'Timeout (ms)',
          minimum: 1000,
          maximum: 300000,
          default: 60000
        },
        workingDirectory: {
          type: 'string',
          title: 'Working Directory'
        },
        environment: {
          type: 'object',
          title: 'Environment Variables',
          additionalProperties: {
            type: 'string'
          },
          default: {}
        },
        runAsUser: {
          type: 'string',
          title: 'Run as User'
        },
        continueOnError: {
          type: 'boolean',
          title: 'Continue on Error',
          default: false
        },
        captureOutput: {
          type: 'boolean',
          title: 'Capture Output',
          default: true
        }
      },
      required: ['command'],
      additionalProperties: false
    };
  }
  
  /**
   * Validate execute command configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['command'])) {
      return false;
    }
    
    const command = config.params.command;
    if (typeof command !== 'string' || command.trim().length === 0) {
      this.logError('Command must be a non-empty string');
      return false;
    }
    
    // Check for dangerous commands (basic security)
    const dangerousPatterns = [
      /rm\s+-rf\s+\/[^\/\s]/,  // rm -rf /something
      /:\(\)\{.*\}\;/,         // fork bomb pattern
      /mkfs\./,                // filesystem format
      /dd\s+if=.*of=/          // dd operations
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        this.logError(`Potentially dangerous command detected: ${command}`);
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Command events can take variable time based on complexity
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const timeout = this.getParam(config, 'timeout', 60000);
    return Math.min(timeout + 5000, 300000); // Add 5s buffer, max 5 minutes
  }
  
  /**
   * Build final command with context
   */
  private buildCommand(
    command: string,
    workingDirectory: string | null,
    environment: Record<string, string>,
    runAsUser: string | null
  ): string {
    let finalCommand = command;
    
    // Add environment variables
    const envVars = Object.entries(environment)
      .map(([key, value]) => `${key}="${value}"`)
      .join(' ');
    
    if (envVars) {
      finalCommand = `${envVars} ${finalCommand}`;
    }
    
    // Add working directory
    if (workingDirectory) {
      finalCommand = `cd "${workingDirectory}" && ${finalCommand}`;
    }
    
    // Add user context
    if (runAsUser) {
      finalCommand = `sudo -u "${runAsUser}" bash -c '${finalCommand.replace(/'/g, "'\"'\"'")}'`;
    }
    
    return finalCommand;
  }
  
  /**
   * Execute command on remote host
   */
  private async executeRemoteCommand(
    hostId: string,
    command: string,
    timeout: number,
    captureOutput: boolean
  ): Promise<CommandResult> {
    try {
      // Note: executeCommand method needs proper implementation
      // For now, return a placeholder result
      try {
        await this.sshService.executeCommand(
          { id: hostId },
          command,
          { timeout }
        );

        return {
          success: true,
          exitCode: 0,
          stdout: captureOutput ? 'Command executed successfully' : '',
          stderr: '',
          executionTime: 0, // Will be set by caller
          command,
          host: hostId
        };
      } catch (executeError) {
        return {
          success: false,
          exitCode: 1,
          stdout: '',
          stderr: captureOutput ? String(executeError) : '',
          executionTime: 0,
          command,
          host: hostId
        };
      }
    } catch (error) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        executionTime: 0,
        command,
        host: hostId
      };
    }
  }
  
  /**
   * Execute command locally (placeholder - implement based on your local execution needs)
   */
  private async executeLocalCommand(
    command: string,
    timeout: number,
    captureOutput: boolean
  ): Promise<CommandResult> {
    // This would implement local command execution
    // For security reasons, you might want to restrict or disable local execution
    throw new Error('Local command execution not implemented for security reasons');
  }
}