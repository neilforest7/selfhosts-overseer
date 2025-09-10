import { Logger } from '@nestjs/common';
import { IPlugin, IPluginValidator, ValidationResult, PluginValidationError } from '../interfaces';

/**
 * Base plugin class providing common functionality
 * All plugins should extend this class
 */
export abstract class BasePlugin implements IPlugin {
  protected readonly logger: Logger;
  
  public abstract readonly id: string;
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly version: string;
  
  public readonly author?: string;
  public readonly tags?: string[];
  public readonly enabled: boolean = true;
  public readonly configSchema?: Record<string, any>;
  public readonly dependencies?: string[];
  
  constructor() {
    this.logger = new Logger(this.constructor.name);
  }
  
  /**
   * Initialize the plugin
   * Override in subclasses for custom initialization
   */
  async initialize(): Promise<void> {
    this.logger.debug(`Initializing plugin: ${this.name} (${this.id})`);
  }
  
  /**
   * Cleanup the plugin
   * Override in subclasses for custom cleanup
   */
  async cleanup(): Promise<void> {
    this.logger.debug(`Cleaning up plugin: ${this.name} (${this.id})`);
  }
  
  /**
   * Validate plugin configuration (IPlugin interface)
   * Override in subclasses for custom validation
   */
  validateConfig(config: any): boolean | Promise<boolean> {
    return true;
  }

  /**
   * Validate plugin configuration with detailed results
   * Implements IPluginValidator interface
   */
  async validateConfigDetailed(config: any): Promise<ValidationResult> {
    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      const suggestions: string[] = [];

      // Call legacy validation method for backward compatibility
      const isValid = await this.validateConfig(config);

      if (!isValid) {
        errors.push('Plugin configuration validation failed');
      }

      // Perform basic validation
      if (!config || typeof config !== 'object') {
        errors.push('Configuration must be a valid object');
      }

      // Call custom validation if implemented
      const customValidation = await this.performCustomValidation(config);
      if (customValidation) {
        errors.push(...customValidation.errors);
        warnings.push(...(customValidation.warnings || []));
        suggestions.push(...(customValidation.suggestions || []));
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestions,
        metadata: {
          pluginId: this.id,
          pluginVersion: this.version,
          validatedAt: new Date(),
          context: 'plugin-validation'
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        isValid: false,
        errors: [`Validation error: ${errorMessage}`],
        metadata: {
          pluginId: this.id,
          pluginVersion: this.version,
          validatedAt: new Date(),
          context: 'plugin-validation-error'
        }
      };
    }
  }

  /**
   * Get validation schema for this plugin
   * Must be implemented by subclasses
   */
  abstract getValidationSchema(): Record<string, any>;

  /**
   * Perform custom validation logic
   * Override in subclasses for plugin-specific validation
   */
  protected async performCustomValidation(_config: any): Promise<{
    errors: string[];
    warnings?: string[];
    suggestions?: string[];
  } | null> {
    return null;
  }

  /**
   * Create a validation error with plugin context
   */
  protected createValidationError(
    errors: string[],
    warnings: string[] = [],
    context?: string
  ): PluginValidationError {
    return new PluginValidationError(
      this.id,
      this.version,
      errors,
      warnings,
      context
    );
  }

  /**
   * Format error message with plugin context
   */
  protected formatErrorMessage(message: string, field?: string, code?: string): string {
    let formattedMessage = `[${this.name}] ${message}`;

    if (field) {
      formattedMessage += ` (field: ${field})`;
    }

    if (code) {
      formattedMessage += ` (code: ${code})`;
    }

    return formattedMessage;
  }

  /**
   * Create structured validation result with enhanced error information
   */
  protected createValidationResult(
    isValid: boolean,
    errors: string[] = [],
    warnings: string[] = [],
    suggestions: string[] = [],
    context?: string
  ): ValidationResult {
    return {
      isValid,
      errors: errors.map(error => this.formatErrorMessage(error)),
      warnings: warnings?.map(warning => this.formatErrorMessage(warning)),
      suggestions: suggestions?.map(suggestion => this.formatErrorMessage(suggestion)),
      metadata: {
        pluginId: this.id,
        pluginVersion: this.version,
        validatedAt: new Date(),
        context: context || 'plugin-validation'
      }
    };
  }

  /**
   * Validate required fields with detailed error messages
   */
  protected validateRequiredFields(
    config: any,
    requiredFields: string[],
    fieldDisplayNames?: Record<string, string>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const field of requiredFields) {
      const value = config?.[field];
      const displayName = fieldDisplayNames?.[field] || field;

      if (value === undefined || value === null) {
        errors.push(`Required field '${displayName}' is missing`);
      } else if (typeof value === 'string' && value.trim() === '') {
        errors.push(`Required field '${displayName}' cannot be empty`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate field types with detailed error messages
   */
  protected validateFieldTypes(
    config: any,
    fieldTypes: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>,
    fieldDisplayNames?: Record<string, string>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [field, expectedType] of Object.entries(fieldTypes)) {
      const value = config?.[field];
      const displayName = fieldDisplayNames?.[field] || field;

      if (value !== undefined && value !== null) {
        let isValidType = false;

        switch (expectedType) {
          case 'string':
            isValidType = typeof value === 'string';
            break;
          case 'number':
            isValidType = typeof value === 'number' && !isNaN(value);
            break;
          case 'boolean':
            isValidType = typeof value === 'boolean';
            break;
          case 'object':
            isValidType = typeof value === 'object' && !Array.isArray(value);
            break;
          case 'array':
            isValidType = Array.isArray(value);
            break;
        }

        if (!isValidType) {
          errors.push(`Field '${displayName}' must be of type ${expectedType}, got ${typeof value}`);
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Create internationalized error messages
   */
  protected createI18nError(
    messageKey: string,
    params?: Record<string, any>,
    locale: string = 'en'
  ): string {
    // Simple i18n implementation - can be enhanced with proper i18n library
    const messages = {
      en: {
        'field.required': 'Field "{field}" is required',
        'field.invalid_type': 'Field "{field}" must be of type {type}',
        'field.invalid_format': 'Field "{field}" has invalid format',
        'field.out_of_range': 'Field "{field}" value is out of range',
        'plugin.not_found': 'Plugin "{pluginId}" not found',
        'plugin.version_mismatch': 'Plugin version mismatch: expected {expected}, got {actual}',
        'validation.failed': 'Validation failed for plugin "{pluginId}"'
      },
      zh: {
        'field.required': '字段 "{field}" 是必需的',
        'field.invalid_type': '字段 "{field}" 必须是 {type} 类型',
        'field.invalid_format': '字段 "{field}" 格式无效',
        'field.out_of_range': '字段 "{field}" 的值超出范围',
        'plugin.not_found': '未找到插件 "{pluginId}"',
        'plugin.version_mismatch': '插件版本不匹配：期望 {expected}，实际 {actual}',
        'validation.failed': '插件 "{pluginId}" 验证失败'
      }
    };

    const localeMessages = messages[locale as keyof typeof messages] || messages.en;
    let message = localeMessages[messageKey as keyof typeof localeMessages] || messageKey;

    // Replace parameters
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        message = message.replace(`{${key}}`, String(value));
      }
    }

    return message;
  }
  
  /**
   * Log info message with plugin context
   */
  protected logInfo(message: string, ...args: any[]): void {
    this.logger.log(`[${this.id}] ${message}`, ...args);
  }
  
  /**
   * Log debug message with plugin context
   */
  protected logDebug(message: string, ...args: any[]): void {
    this.logger.debug(`[${this.id}] ${message}`, ...args);
  }
  
  /**
   * Log warning message with plugin context
   */
  protected logWarn(message: string, ...args: any[]): void {
    this.logger.warn(`[${this.id}] ${message}`, ...args);
  }
  
  /**
   * Log error message with plugin context
   */
  protected logError(message: string, error?: any): void {
    this.logger.error(`[${this.id}] ${message}`, error);
  }
}