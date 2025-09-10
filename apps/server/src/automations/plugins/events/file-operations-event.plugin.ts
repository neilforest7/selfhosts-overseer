import { Injectable } from '@nestjs/common';
import { BaseEventPlugin } from '../base';
import { EventConfig, EventContext, EventResult } from '../interfaces';
import { OperationLogService } from '../../../operation-log/operation-log.service';
import { SshService } from '../../../ssh/ssh.service';
import * as path from 'path';

interface FileOperationResult {
  success: boolean;
  operation: string;
  sourcePath?: string;
  targetPath?: string;
  size?: number;
  permissions?: string;
  error?: string;
}

/**
 * File operations event plugin
 * Performs various file system operations (create, copy, move, delete, chmod, etc.)
 */
@Injectable()
export class FileOperationsEventPlugin extends BaseEventPlugin {
  public readonly id = 'file-operations-event';
  public readonly name = 'File Operations';
  public readonly description = 'Performs file system operations';
  public readonly version = '1.0.0';
  public readonly author = 'Self-Host Serv Agent';
  public readonly tags = ['file', 'filesystem', 'operations', 'remote'];
  public readonly eventType = 'file-operations';
  
  constructor(
    private readonly operationLogService: OperationLogService,
    private readonly sshService: SshService
  ) {
    super();
  }
  
  /**
   * Execute the file operations event
   */
  public async execute(config: EventConfig, context: EventContext): Promise<EventResult> {
    try {
      const operation = this.getParam(config, 'operation', 'create') as string;
      const sourcePath = this.getParam(config, 'sourcePath', '');
      const targetPath = this.getParam(config, 'targetPath', '');
      const content = this.getParam(config, 'content', '');
      const permissions = this.getParam(config, 'permissions', null);
      const createDirectories = this.getParam(config, 'createDirectories', false);
      const backup = this.getParam(config, 'backup', false);
      const hostId = this.getParam(config, 'hostId', null);
      const owner = this.getParam(config, 'owner', null);
      
      // Validate required parameters based on operation
      const validationError = this.validateOperationParams(operation, sourcePath, targetPath, content);
      if (validationError) {
        return this.createFailureResult(validationError);
      }
      
      let result: FileOperationResult;
      
      switch (operation) {
        case 'create':
          result = await this.createFile(hostId, sourcePath, content, permissions, createDirectories);
          break;
        case 'copy':
          result = await this.copyFile(hostId, sourcePath, targetPath, backup, createDirectories);
          break;
        case 'move':
          result = await this.moveFile(hostId, sourcePath, targetPath, backup, createDirectories);
          break;
        case 'delete':
          result = await this.deleteFile(hostId, sourcePath, backup);
          break;
        case 'chmod':
          result = await this.changePermissions(hostId, sourcePath, permissions);
          break;
        case 'chown':
          result = await this.changeOwner(hostId, sourcePath, owner);
          break;
        case 'mkdir':
          result = await this.createDirectory(hostId, sourcePath, permissions);
          break;
        case 'append':
          result = await this.appendToFile(hostId, sourcePath, content);
          break;
        default:
          return this.createFailureResult(`Unsupported operation: ${operation}`);
      }
      
      if (result.success) {
        this.operationLogService.log('info', `File operation completed: ${operation} on ${sourcePath || targetPath}`);
        return this.createSuccessResult(
          `File operation '${operation}' completed successfully`,
          result
        );
      } else {
        this.operationLogService.log('error', `File operation failed: ${operation} - ${result.error}`);
        return this.createFailureResult(`File operation failed: ${result.error}`);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError('Failed to execute file operation', error);
      this.operationLogService.log('error', `File operation failed: ${errorMessage}`);
      return this.createFailureResult(`File operation failed: ${errorMessage}`);
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
          const: 'file-operations'
        },
        params: {
          $ref: '#/definitions/FileOperationsParams'
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
              maximum: 120000,
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
        FileOperationsParams: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              title: 'File Operation',
              description: 'Type of file system operation to perform',
              enum: ['create', 'copy', 'move', 'delete', 'chmod', 'chown', 'mkdir', 'append', 'backup'],
              default: 'create',
              examples: ['create', 'copy', 'move', 'delete', 'backup']
            },
            sourcePath: {
              type: 'string',
              title: 'Source Path',
              description: 'Source file or directory path (absolute path recommended)',
              minLength: 1,
              maxLength: 1000,
              placeholder: '/path/to/source/file',
              examples: [
                '/home/user/config.json',
                '/var/log/app.log',
                '/etc/nginx/nginx.conf',
                '/opt/app/data',
                '/backup/database.sql'
              ]
            },
            targetPath: {
              type: 'string',
              title: 'Target Path',
              description: 'Target file or directory path (required for copy/move/backup operations)',
              maxLength: 1000,
              placeholder: '/path/to/target/file',
              examples: [
                '/backup/config.json',
                '/tmp/app.log.backup',
                '/etc/nginx/nginx.conf.bak',
                '/archive/data-backup'
              ]
            },
            content: {
              type: 'string',
              title: 'File Content',
              description: 'Content to write to file (for create/append operations)',
              format: 'textarea',
              maxLength: 10000,
              placeholder: 'Enter file content here',
              examples: [
                'Hello World',
                '{"config": "value"}',
                'server {\n  listen 80;\n  server_name example.com;\n}'
              ]
            },
            permissions: {
              type: 'string',
              title: 'File Permissions',
              description: 'File permissions in octal format (3-4 digits)',
              pattern: '^[0-7]{3,4}$',
              placeholder: '644',
              examples: ['644', '755', '600', '700', '0644', '0755']
            },
            owner: {
              type: 'string',
              title: 'File Owner',
              description: 'File owner in user:group format (requires sudo)',
              placeholder: 'user:group',
              examples: [
                'www-data:www-data',
                'nginx:nginx',
                'user:users',
                'root:root',
                'app:app'
              ]
            },
            hostId: {
              type: 'string',
              title: 'Target Host',
              description: 'Host to perform file operation on (leave empty for local)',
              placeholder: 'Select a host'
            },
            createDirectories: {
              type: 'boolean',
              title: 'Create Directories',
              description: 'Create parent directories if they don\'t exist',
              default: false
            },
            backup: {
              type: 'boolean',
              title: 'Create Backup',
              description: 'Create backup before modifying existing files',
              default: false
            },
            encoding: {
              type: 'string',
              title: 'File Encoding',
              description: 'Character encoding for text files',
              enum: ['utf8', 'ascii', 'base64', 'hex'],
              default: 'utf8'
            },
            recursive: {
              type: 'boolean',
              title: 'Recursive',
              description: 'Apply operation recursively to directories',
              default: false
            }
          },
          required: ['operation', 'sourcePath']
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
        operation: {
          type: 'string',
          title: 'Operation',
          enum: ['create', 'copy', 'move', 'delete', 'chmod', 'chown', 'mkdir', 'append'],
          default: 'create'
        },
        sourcePath: {
          type: 'string',
          title: 'Source Path',
          minLength: 1,
          maxLength: 1000
        },
        targetPath: {
          type: 'string',
          title: 'Target Path',
          maxLength: 1000
        },
        content: {
          type: 'string',
          title: 'Content',
          maxLength: 10000
        },
        permissions: {
          type: 'string',
          title: 'Permissions',
          pattern: '^[0-7]{3,4}$'
        },
        owner: {
          type: 'string',
          title: 'Owner'
        },
        hostId: {
          type: 'string',
          title: 'Host ID'
        },
        createDirectories: {
          type: 'boolean',
          title: 'Create Directories',
          default: false
        },
        backup: {
          type: 'boolean',
          title: 'Create Backup',
          default: false
        }
      },
      required: ['operation', 'sourcePath'],
      additionalProperties: false
    };
  }
  
  /**
   * Validate file operations configuration
   */
  protected async validateCustomConfig(config: EventConfig): Promise<boolean> {
    if (!this.validateRequiredParams(config, ['operation', 'sourcePath'])) {
      return false;
    }
    
    const operation = config.params.operation;
    const validOperations = ['create', 'copy', 'move', 'delete', 'chmod', 'chown', 'mkdir', 'append'];
    
    if (!validOperations.includes(operation)) {
      this.logError(`Invalid operation: ${operation}`);
      return false;
    }
    
    // Validate paths are absolute
    const sourcePath = config.params.sourcePath;
    if (sourcePath && !path.isAbsolute(sourcePath)) {
      this.logError('Source path must be absolute');
      return false;
    }
    
    const targetPath = config.params.targetPath;
    if (targetPath && !path.isAbsolute(targetPath)) {
      this.logError('Target path must be absolute');
      return false;
    }
    
    return true;
  }
  
  /**
   * File operations typically execute quickly
   */
  public getEstimatedExecutionTime(config: EventConfig): number {
    const operation = this.getParam(config, 'operation', 'create') as string;
    
    // Estimate based on operation type
    switch (operation) {
      case 'copy':
      case 'move':
        return 15000; // 15 seconds for file operations
      case 'delete':
        return 5000;  // 5 seconds for delete
      default:
        return 10000; // 10 seconds for other operations
    }
  }
  
  /**
   * Validate operation parameters
   */
  private validateOperationParams(
    operation: string,
    sourcePath: string,
    targetPath: string,
    content: string
  ): string | null {
    switch (operation) {
      case 'copy':
      case 'move':
        if (!targetPath) {
          return `${operation} operation requires both sourcePath and targetPath`;
        }
        break;
      case 'create':
        if (!content) {
          return 'Create operation requires content parameter';
        }
        break;
      case 'append':
        if (!content) {
          return 'Append operation requires content parameter';
        }
        break;
    }
    
    return null;
  }
  
  /**
   * Create a new file
   */
  private async createFile(
    hostId: string | null,
    filePath: string,
    content: string,
    permissions: string | null,
    createDirectories: boolean
  ): Promise<FileOperationResult> {
    try {
      let commands = [];
      
      if (createDirectories) {
        const directory = path.dirname(filePath);
        commands.push(`mkdir -p "${directory}"`);
      }
      
      // Create file with content (handle special characters)
      const escapedContent = content.replace(/'/g, "'\"'\"'");
      commands.push(`echo '${escapedContent}' > "${filePath}"`);
      
      if (permissions) {
        commands.push(`chmod ${permissions} "${filePath}"`);
      }
      
      const command = commands.join(' && ');
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'create',
        sourcePath: filePath,
        permissions: permissions || undefined,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'create',
        sourcePath: filePath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Copy a file
   */
  private async copyFile(
    hostId: string | null,
    sourcePath: string,
    targetPath: string,
    backup: boolean,
    createDirectories: boolean
  ): Promise<FileOperationResult> {
    try {
      let commands = [];
      
      if (createDirectories) {
        const directory = path.dirname(targetPath);
        commands.push(`mkdir -p "${directory}"`);
      }
      
      if (backup && targetPath) {
        commands.push(`[ -f "${targetPath}" ] && cp "${targetPath}" "${targetPath}.bak" || true`);
      }
      
      commands.push(`cp "${sourcePath}" "${targetPath}"`);
      
      const command = commands.join(' && ');
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'copy',
        sourcePath,
        targetPath,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'copy',
        sourcePath,
        targetPath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Move a file
   */
  private async moveFile(
    hostId: string | null,
    sourcePath: string,
    targetPath: string,
    backup: boolean,
    createDirectories: boolean
  ): Promise<FileOperationResult> {
    try {
      let commands = [];
      
      if (createDirectories) {
        const directory = path.dirname(targetPath);
        commands.push(`mkdir -p "${directory}"`);
      }
      
      if (backup && targetPath) {
        commands.push(`[ -f "${targetPath}" ] && cp "${targetPath}" "${targetPath}.bak" || true`);
      }
      
      commands.push(`mv "${sourcePath}" "${targetPath}"`);
      
      const command = commands.join(' && ');
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'move',
        sourcePath,
        targetPath,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'move',
        sourcePath,
        targetPath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Delete a file
   */
  private async deleteFile(
    hostId: string | null,
    filePath: string,
    backup: boolean
  ): Promise<FileOperationResult> {
    try {
      let commands = [];
      
      if (backup) {
        commands.push(`[ -f "${filePath}" ] && cp "${filePath}" "${filePath}.bak" || true`);
      }
      
      commands.push(`rm -f "${filePath}"`);
      
      const command = commands.join(' && ');
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'delete',
        sourcePath: filePath,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'delete',
        sourcePath: filePath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Change file permissions
   */
  private async changePermissions(
    hostId: string | null,
    filePath: string,
    permissions: string | null
  ): Promise<FileOperationResult> {
    if (!permissions) {
      return {
        success: false,
        operation: 'chmod',
        sourcePath: filePath,
        error: 'Permissions parameter is required for chmod operation'
      };
    }
    
    try {
      const command = `chmod ${permissions} "${filePath}"`;
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'chmod',
        sourcePath: filePath,
        permissions,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'chmod',
        sourcePath: filePath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Change file owner
   */
  private async changeOwner(
    hostId: string | null,
    filePath: string,
    owner: string | null
  ): Promise<FileOperationResult> {
    if (!owner) {
      return {
        success: false,
        operation: 'chown',
        sourcePath: filePath,
        error: 'Owner parameter is required for chown operation'
      };
    }
    
    try {
      const command = `chown ${owner} "${filePath}"`;
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'chown',
        sourcePath: filePath,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'chown',
        sourcePath: filePath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Create directory
   */
  private async createDirectory(
    hostId: string | null,
    dirPath: string,
    permissions: string | null
  ): Promise<FileOperationResult> {
    try {
      let commands = [`mkdir -p "${dirPath}"`];
      
      if (permissions) {
        commands.push(`chmod ${permissions} "${dirPath}"`);
      }
      
      const command = commands.join(' && ');
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'mkdir',
        sourcePath: dirPath,
        permissions: permissions || undefined,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'mkdir',
        sourcePath: dirPath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Append content to file
   */
  private async appendToFile(
    hostId: string | null,
    filePath: string,
    content: string
  ): Promise<FileOperationResult> {
    try {
      const escapedContent = content.replace(/'/g, "'\"'\"'");
      const command = `echo '${escapedContent}' >> "${filePath}"`;
      const result = await this.executeCommand(hostId, command);
      
      return {
        success: result.success,
        operation: 'append',
        sourcePath: filePath,
        error: result.success ? undefined : result.stderr
      };
    } catch (error) {
      return {
        success: false,
        operation: 'append',
        sourcePath: filePath,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Execute command on host
   */
  private async executeCommand(hostId: string | null, command: string): Promise<{ success: boolean; stderr: string }> {
    if (!hostId) {
      throw new Error('Local file operations not supported');
    }
    
    try {
      await this.sshService.executeCommand({ id: hostId }, command);
      return {
        success: true,
        stderr: ''
      };
    } catch (error) {
      return {
        success: false,
        stderr: error instanceof Error ? error.message : String(error)
      };
    }
  }
}