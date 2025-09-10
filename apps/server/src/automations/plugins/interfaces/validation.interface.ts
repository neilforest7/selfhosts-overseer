/**
 * Validation interfaces for plugin system
 * Provides unified validation standards for all automation plugins
 */

/**
 * Validation result returned by plugin validation methods
 */
export interface ValidationResult {
  /** Whether the validation passed */
  isValid: boolean;
  
  /** Array of error messages if validation failed */
  errors: string[];
  
  /** Array of warning messages (non-blocking issues) */
  warnings?: string[];
  
  /** Array of suggestions for improvement */
  suggestions?: string[];
  
  /** Additional metadata about the validation */
  metadata?: {
    /** Plugin ID that performed the validation */
    pluginId?: string;
    
    /** Plugin version */
    pluginVersion?: string;
    
    /** Validation timestamp */
    validatedAt?: Date;
    
    /** Validation context */
    context?: string;
  };
}

/**
 * Unified plugin validator interface
 * All plugins should implement this interface for consistent validation
 */
export interface IPluginValidator {
  /**
   * Validate plugin configuration
   * @param config Configuration object to validate
   * @returns Promise<ValidationResult> validation result with errors/warnings
   */
  validateConfig(config: any): Promise<ValidationResult>;
  
  /**
   * Get validation schema for this plugin
   * Used for UI generation and client-side validation
   * @returns JSON Schema object describing valid configuration
   */
  getValidationSchema(): Record<string, any>;
  
  /**
   * Get human-readable validation rules
   * Optional method for providing user-friendly validation descriptions
   * @returns Object describing validation rules in human-readable format
   */
  getValidationRules?(): {
    required?: string[];
    optional?: string[];
    constraints?: Record<string, string>;
    examples?: Record<string, any>;
  };
}

/**
 * Plugin validation error class
 * Structured error information for plugin validation failures
 */
export class PluginValidationError extends Error {
  public readonly pluginId: string;
  public readonly pluginVersion: string;
  public readonly validationErrors: string[];
  public readonly validationWarnings: string[];
  public readonly context?: string;
  
  constructor(
    pluginId: string,
    pluginVersion: string,
    errors: string[],
    warnings: string[] = [],
    context?: string
  ) {
    const message = `Plugin validation failed for ${pluginId}@${pluginVersion}: ${errors.join(', ')}`;
    super(message);
    
    this.name = 'PluginValidationError';
    this.pluginId = pluginId;
    this.pluginVersion = pluginVersion;
    this.validationErrors = errors;
    this.validationWarnings = warnings;
    this.context = context;
    
    // Maintain proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PluginValidationError);
    }
  }
  
  /**
   * Convert to ValidationResult format
   */
  toValidationResult(): ValidationResult {
    return {
      isValid: false,
      errors: this.validationErrors,
      warnings: this.validationWarnings,
      metadata: {
        pluginId: this.pluginId,
        pluginVersion: this.pluginVersion,
        validatedAt: new Date(),
        context: this.context
      }
    };
  }
  
  /**
   * Create user-friendly error message
   */
  getUserFriendlyMessage(): string {
    const errorCount = this.validationErrors.length;
    const warningCount = this.validationWarnings.length;
    
    let message = `Plugin "${this.pluginId}" configuration has ${errorCount} error${errorCount !== 1 ? 's' : ''}`;
    
    if (warningCount > 0) {
      message += ` and ${warningCount} warning${warningCount !== 1 ? 's' : ''}`;
    }
    
    message += ':\n';
    
    // Add errors
    this.validationErrors.forEach((error, index) => {
      message += `  ${index + 1}. ❌ ${error}\n`;
    });
    
    // Add warnings
    this.validationWarnings.forEach((warning, index) => {
      message += `  ${index + 1}. ⚠️  ${warning}\n`;
    });
    
    return message.trim();
  }
}

/**
 * Validation context for plugin validation
 */
export interface ValidationContext {
  /** Operation being performed (create, update, test) */
  operation: 'create' | 'update' | 'test' | 'validate';
  
  /** User or system performing the validation */
  actor?: string;
  
  /** Rule ID if validating in context of a specific rule */
  ruleId?: string;
  
  /** Additional context data */
  metadata?: Record<string, any>;
}

/**
 * Validation severity levels
 */
export enum ValidationSeverity {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
  SUGGESTION = 'suggestion'
}

/**
 * Detailed validation issue
 */
export interface ValidationIssue {
  /** Severity level of the issue */
  severity: ValidationSeverity;
  
  /** Issue message */
  message: string;
  
  /** Field path that caused the issue */
  field?: string;
  
  /** Error code for programmatic handling */
  code?: string;
  
  /** Suggested fix for the issue */
  suggestion?: string;
  
  /** Additional context */
  context?: Record<string, any>;
}

/**
 * Enhanced validation result with detailed issues
 */
export interface DetailedValidationResult extends ValidationResult {
  /** Detailed list of validation issues */
  issues: ValidationIssue[];
  
  /** Performance metrics */
  performance?: {
    /** Validation duration in milliseconds */
    duration: number;
    
    /** Number of rules checked */
    rulesChecked: number;
  };
}
