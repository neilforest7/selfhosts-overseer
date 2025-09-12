/**
 * 自动化规则更新策略接口定义
 * 
 * 定义了更新验证、策略选择和执行上下文的相关接口
 */

import { CreateTriggerDto, CreateEventDto, CreateNotificationDto } from '../dto/create-automation-rule.dto';

/**
 * 更新验证结果
 */
export interface UpdateValidationResult {
  /** 验证是否通过 */
  isValid: boolean;
  
  /** 错误信息列表 */
  errors: string[];
  
  /** 警告信息列表 */
  warnings: string[];
  
  /** 插件验证结果 */
  pluginValidations?: {
    triggers: PluginValidationResult[];
    events: PluginValidationResult[];
  };
  
  /** 验证元数据 */
  metadata?: {
    validatedAt: Date;
    validatorVersion: string;
    context?: string;
  };
}

/**
 * 插件验证结果
 */
export interface PluginValidationResult {
  /** 插件ID */
  pluginId: string;
  
  /** 插件类型 */
  pluginType: 'trigger' | 'event';
  
  /** 验证是否通过 */
  isValid: boolean;
  
  /** 错误信息 */
  errors: string[];
  
  /** 警告信息 */
  warnings?: string[];
  
  /** 插件配置验证详情 */
  configValidation?: {
    isValid: boolean;
    errors: string[];
    warnings?: string[];
  };
}

/**
 * 增强的更新数据
 */
export interface EnhancedUpdateData {
  /** 规则名称 */
  name?: string;
  
  /** 规则描述 */
  description?: string;
  
  /** 是否启用 */
  isEnabled?: boolean;
  
  /** 优先级 */
  priority?: number;
  
  /** 分类 */
  category?: string;
  
  /** 标签 */
  tags?: string[];
  
  /** 版本 */
  version?: string;
  
  /** 触发器配置 */
  triggers?: CreateTriggerDto[];
  
  /** 事件配置 */
  events?: CreateEventDto[];
  
  /** 通知配置 */
  notifications?: CreateNotificationDto[];
  
  /** 更新元数据 */
  metadata?: {
    updatedBy?: string;
    updateReason?: string;
    updateSource?: 'ui' | 'api' | 'migration' | 'template';
    batchId?: string;
  };
}

/**
 * 更新上下文
 */
export interface UpdateContext {
  /** 更新发起者 */
  userId?: string;
  
  /** 更新来源 */
  source: 'ui' | 'api' | 'migration' | 'template' | 'system';
  
  /** 是否为批量更新 */
  isBatchUpdate?: boolean;
  
  /** 批次ID */
  batchId?: string;
  
  /** 更新策略 */
  strategy?: 'replace' | 'merge' | 'diff';
  
  /** 验证选项 */
  validationOptions?: {
    skipPluginValidation?: boolean;
    skipBusinessRules?: boolean;
    allowWarnings?: boolean;
  };
  
  /** 执行选项 */
  executionOptions?: {
    dryRun?: boolean;
    createBackup?: boolean;
    rollbackOnError?: boolean;
  };
  
  /** 上下文元数据 */
  metadata?: Record<string, any>;
  
  /** 预期版本（用于乐观锁） */
  expectedVersion?: Date;
}

/**
 * 更新策略枚举
 */
export enum UpdateStrategy {
  /** 完全替换 - 删除所有现有嵌套记录，重新创建 */
  REPLACE = 'replace',
  
  /** 智能合并 - 比较差异，只更新变更部分 */
  MERGE = 'merge',
  
  /** 差异更新 - 基于提供的差异信息进行更新 */
  DIFF = 'diff'
}

/**
 * 更新执行结果
 */
export interface UpdateExecutionResult {
  /** 执行是否成功 */
  success: boolean;
  
  /** 更新的规则ID */
  ruleId: string;
  
  /** 执行时间（毫秒） */
  executionTime: number;
  
  /** 更新统计 */
  statistics: {
    triggersCreated: number;
    triggersUpdated: number;
    triggersDeleted: number;
    eventsCreated: number;
    eventsUpdated: number;
    eventsDeleted: number;
    notificationsCreated: number;
    notificationsUpdated: number;
    notificationsDeleted: number;
  };
  
  /** 错误信息 */
  errors?: string[];
  
  /** 警告信息 */
  warnings?: string[];
  
  /** 回滚信息 */
  rollbackInfo?: {
    available: boolean;
    backupId?: string;
    rollbackSteps?: string[];
  };
}
