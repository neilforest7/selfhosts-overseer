/**
 * 配置序列化工具
 * 
 * 提供前端表单数据与后端API之间的双向转换功能
 */

export interface PluginConfig {
  [key: string]: any;
}

export interface FormData {
  name: string;
  description?: string;
  triggerType: string;
  triggerConfig?: PluginConfig;
  eventType: string;
  eventConfig?: PluginConfig;
  [key: string]: any; // 支持动态字段
}

export interface NormalizedRuleData {
  name: string;
  description?: string;
  isEnabled: boolean;
  triggers: Array<{
    type: string;
    pluginId: string;
    pluginVersion: string;
    config: string; // JSON字符串
  }>;
  events: Array<{
    type: string;
    pluginId: string;
    pluginVersion: string;
    params: string; // JSON字符串
  }>;
  notifications?: Array<{
    notifyOn: string[];
    channels: Array<{
      type: string;
      config: string; // JSON字符串
    }>;
  }>;
}

// 兼容实际的AutomationRule类型
export interface AutomationRule {
  id?: string;
  name: string;
  description?: string | null;
  isEnabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
  _count?: {
    operations: number;
  };
  errorCount?: number;
  triggers?: Array<{
    id?: string;
    type: string;
    name?: string;
    description?: string;
    isEnabled?: boolean;
    priority?: number;
    pluginId?: string;
    pluginVersion?: string;
    config?: Record<string, any>;
    conditions?: Record<string, any>;
  }>;
  events?: Array<{
    id?: string;
    type: string;
    name?: string;
    description?: string;
    isEnabled?: boolean;
    priority?: number;
    pluginId?: string;
    pluginVersion?: string;
    params?: Record<string, any>;
    options?: Record<string, any>;
  }>;
  notifications?: Array<{
    id?: string;
    name?: string;
    description?: string;
    isEnabled?: boolean;
    notifyOn?: string;
    templateId?: string;
    channels?: Array<{
      id?: string;
      type: string;
      config?: Record<string, any>;
      isEnabled?: boolean;
    }>;
  }>;
  // 兼容旧格式
  ruleJson?: any;
}

/**
 * 配置序列化器类
 */
export class ConfigSerializer {
  /**
   * 将自动化规则转换为表单数据
   */
  static ruleToFormData(rule: AutomationRule): FormData {
    const formData: FormData = {
      name: rule.name,
      description: rule.description || '',
      triggerType: '',
      triggerConfig: {},
      eventType: '',
      eventConfig: {},
    };

    // 处理触发器配置
    if (rule.triggers && rule.triggers.length > 0) {
      const firstTrigger = rule.triggers[0];
      formData.triggerType = firstTrigger.type || '';
      formData.triggerConfig = firstTrigger.config || {};
      
      // 展平嵌套配置为表单字段
      this.flattenConfig(firstTrigger.config || {}, 'triggerConfig', formData);
    } else if (rule.ruleJson?.conditions?.all?.[0]?.params) {
      // 兼容旧格式
      const params = rule.ruleJson.conditions.all[0].params;
      formData.triggerType = params.type || '';
      formData.triggerConfig = params.config || {};
      this.flattenConfig(params.config || {}, 'triggerConfig', formData);
    }

    // 处理事件配置
    if (rule.events && rule.events.length > 0) {
      const firstEvent = rule.events[0];
      formData.eventType = firstEvent.type || '';
      formData.eventConfig = firstEvent.params || {};
      
      // 展平嵌套配置为表单字段
      this.flattenConfig(firstEvent.params || {}, 'eventConfig', formData);
    } else if (rule.ruleJson?.event) {
      // 兼容旧格式
      const event = rule.ruleJson.event;
      formData.eventType = event.type || '';
      formData.eventConfig = event.params || {};
      this.flattenConfig(event.params || {}, 'eventConfig', formData);
    }

    return formData;
  }

  /**
   * 将表单数据转换为标准化规则数据
   */
  static formDataToNormalizedRule(
    formData: FormData,
    triggerPluginId: string,
    triggerPluginVersion: string,
    eventPluginId: string,
    eventPluginVersion: string
  ): NormalizedRuleData {
    // 提取触发器配置
    const triggerConfig = this.extractNestedConfig(formData, 'triggerConfig');
    
    // 提取事件配置
    const eventConfig = this.extractNestedConfig(formData, 'eventConfig');

    return {
      name: formData.name,
      description: formData.description,
      isEnabled: true,
      triggers: [{
        type: formData.triggerType,
        pluginId: triggerPluginId,
        pluginVersion: triggerPluginVersion,
        config: JSON.stringify(triggerConfig)
      }],
      events: [{
        type: formData.eventType,
        pluginId: eventPluginId,
        pluginVersion: eventPluginVersion,
        params: JSON.stringify(eventConfig)
      }],
      notifications: []
    };
  }

  /**
   * 展平嵌套配置对象为表单字段
   */
  private static flattenConfig(
    config: PluginConfig, 
    prefix: string, 
    target: Record<string, any>
  ): void {
    if (!config || typeof config !== 'object') return;

    Object.entries(config).forEach(([key, value]) => {
      const fieldName = `${prefix}.${key}`;
      target[fieldName] = value;
    });
  }

  /**
   * 从表单数据中提取嵌套配置
   */
  private static extractNestedConfig(
    formData: FormData, 
    configType: 'triggerConfig' | 'eventConfig'
  ): PluginConfig {
    const config: PluginConfig = {};

    // 方法1: 检查嵌套对象
    const nestedConfig = formData[configType];
    if (nestedConfig && typeof nestedConfig === 'object') {
      Object.entries(nestedConfig).forEach(([key, value]) => {
        if (this.isValidConfigValue(value)) {
          config[key] = value;
        }
      });
    }

    // 方法2: 检查展平的字段（向后兼容）
    // 重要：当“嵌套对象”和“展平字段”同时存在时，优先使用“嵌套对象”的最新值。
    // 因为编辑表单会同步写入嵌套对象，避免被旧的展平快照覆盖。
    const prefix = `${configType}.`;
    Object.entries(formData).forEach(([key, value]) => {
      if (key.startsWith(prefix)) {
        const configKey = key.replace(prefix, '');
        if (this.isValidConfigValue(value)) {
          // 仅当嵌套对象中尚未提供该字段时，才采用展平字段的值
          if (config[configKey] === undefined) {
            config[configKey] = value;
          }
        }
      }
    });

    return config;
  }

  /**
   * 验证配置值是否有效
   */
  private static isValidConfigValue(value: any): boolean {
    return value !== undefined && 
           value !== null && 
           value !== '' && 
           !(Array.isArray(value) && value.length === 0) &&
           !(typeof value === 'object' && Object.keys(value).length === 0);
  }

  /**
   * 深度比较两个配置对象
   */
  static compareConfigs(oldConfig: PluginConfig, newConfig: PluginConfig): {
    hasChanges: boolean;
    changes: Array<{
      field: string;
      oldValue: any;
      newValue: any;
      changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
    }>;
  } {
    const changes: Array<{
      field: string;
      oldValue: any;
      newValue: any;
      changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
    }> = [];

    // 获取所有字段
    const allKeys = new Set([
      ...Object.keys(oldConfig || {}),
      ...Object.keys(newConfig || {})
    ]);

    allKeys.forEach(key => {
      const oldValue = oldConfig?.[key];
      const newValue = newConfig?.[key];

      if (oldValue === undefined && newValue !== undefined) {
        changes.push({
          field: key,
          oldValue: undefined,
          newValue,
          changeType: 'ADDED'
        });
      } else if (oldValue !== undefined && newValue === undefined) {
        changes.push({
          field: key,
          oldValue,
          newValue: undefined,
          changeType: 'REMOVED'
        });
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          field: key,
          oldValue,
          newValue,
          changeType: 'MODIFIED'
        });
      }
    });

    return {
      hasChanges: changes.length > 0,
      changes
    };
  }

  /**
   * 验证配置数据的完整性
   */
  static validateConfig(config: PluginConfig, schema?: any): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // 基础验证
    if (!config || typeof config !== 'object') {
      errors.push('配置必须是一个对象');
      return { isValid: false, errors };
    }

    // 如果提供了schema，进行schema验证
    if (schema && typeof schema === 'object') {
      // 处理新版本插件schema格式（包含properties和required）
      if (schema.properties && Array.isArray(schema.required)) {
        schema.required.forEach((field: string) => {
          if (!(field in config) || config[field] === undefined || config[field] === '') {
            // 检查是否有默认值
            const propertySchema = schema.properties[field];
            if (propertySchema && propertySchema.default !== undefined) {
              // 有默认值，不是错误
              return;
            }
            errors.push(`必需字段 "${field}" 缺失或为空`);
          }
        });

        // 验证字段类型和格式
        Object.entries(config).forEach(([key, value]) => {
          if (schema.properties[key]) {
            const propertySchema = schema.properties[key];
            
            // 类型验证
            if (propertySchema.type && typeof value !== propertySchema.type) {
              // 特殊处理：字符串类型但值为数字的情况
              if (propertySchema.type === 'string' && typeof value === 'number') {
                config[key] = String(value); // 自动转换
              } else if (propertySchema.type === 'number' && typeof value === 'string') {
                const numValue = Number(value);
                if (!isNaN(numValue)) {
                  config[key] = numValue; // 自动转换
                } else {
                  errors.push(`字段 "${key}" 必须是数字类型`);
                }
              }
            }

            // 最小长度验证
            if (propertySchema.minLength && String(value).length < propertySchema.minLength) {
              errors.push(`字段 "${key}" 长度不能少于 ${propertySchema.minLength} 个字符`);
            }

            // 最大长度验证
            if (propertySchema.maxLength && String(value).length > propertySchema.maxLength) {
              errors.push(`字段 "${key}" 长度不能超过 ${propertySchema.maxLength} 个字符`);
            }

            // 枚举值验证
            if (propertySchema.enum && !propertySchema.enum.includes(value)) {
              errors.push(`字段 "${key}" 必须是以下值之一: ${propertySchema.enum.join(', ')}`);
            }

            // 正则表达式验证
            if (propertySchema.pattern && typeof value === 'string') {
              const regex = new RegExp(propertySchema.pattern);
              if (!regex.test(value)) {
                errors.push(`字段 "${key}" 格式不正确`);
              }
            }

            // 数字范围验证
            if (propertySchema.type === 'number') {
              if (propertySchema.minimum !== undefined && value < propertySchema.minimum) {
                errors.push(`字段 "${key}" 不能小于 ${propertySchema.minimum}`);
              }
              if (propertySchema.maximum !== undefined && value > propertySchema.maximum) {
                errors.push(`字段 "${key}" 不能大于 ${propertySchema.maximum}`);
              }
            }
          }
        });
      }
      // 处理旧版本插件schema格式（只有required数组）
      else if (schema.required && Array.isArray(schema.required)) {
        schema.required.forEach((field: string) => {
          if (!(field in config) || config[field] === undefined || config[field] === '') {
            errors.push(`必需字段 "${field}" 缺失或为空`);
          }
        });
      }
    }

    // 检查JSON序列化是否会失败
    try {
      JSON.stringify(config);
    } catch (e) {
      errors.push('配置包含无法序列化的值');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 清理配置对象，移除无效值
   */
  static cleanConfig(config: PluginConfig): PluginConfig {
    const cleaned: PluginConfig = {};

    Object.entries(config).forEach(([key, value]) => {
      if (this.isValidConfigValue(value)) {
        cleaned[key] = value;
      }
    });

    return cleaned;
  }
}
