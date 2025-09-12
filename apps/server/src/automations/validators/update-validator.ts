/**
 * 自动化规则更新验证器
 * 
 * 提供全面的更新数据验证，包括基础字段、嵌套关系、插件兼容性等
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PluginRegistry } from '../plugins/registry/plugin-registry.service';
import { PluginValidationError, ValidationResult } from '../plugins/interfaces/validation.interface';
import {
  UpdateValidationResult,
  PluginValidationResult,
  EnhancedUpdateData,
  UpdateContext
} from '../interfaces/update-strategy.interface';
import { CreateTriggerDto, CreateEventDto, CreateNotificationDto } from '../dto/create-automation-rule.dto';

@Injectable()
export class UpdateValidator {
  private readonly logger = new Logger(UpdateValidator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginRegistry: PluginRegistry
  ) {}

  /**
   * 验证完整的更新数据
   */
  async validateUpdate(
    ruleId: string,
    data: EnhancedUpdateData,
    context: UpdateContext
  ): Promise<UpdateValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // 1. 验证规则存在性
      const existingRule = await this.validateRuleExists(ruleId);
      if (!existingRule) {
        errors.push(`Automation rule with ID ${ruleId} not found`);
        return {
          isValid: false,
          errors,
          warnings,
          pluginValidations: { triggers: [], events: [] }
        };
      }

      // 2. 验证基础字段
      const basicFieldErrors = this.validateBasicFields(data);
      errors.push(...basicFieldErrors);

      // 3. 验证规则名称唯一性（如果名称被更改）
      if (data.name && data.name !== existingRule.name) {
        const nameConflict = await this.validateNameUniqueness(data.name, ruleId);
        if (nameConflict) {
          errors.push(`Rule name "${data.name}" already exists`);
        }
      }

      // 4. 验证版本控制（乐观锁）
      if (context.expectedVersion) {
        const versionValid = this.validateVersion(existingRule.updatedAt, context.expectedVersion.getTime());
        if (!versionValid) {
          errors.push('Rule has been modified by another user. Please refresh and try again.');
        }
      }

      // 5. 验证插件配置
      const pluginValidation = await this.validatePluginConfigurations(data);
      
      // 收集插件验证错误
      const pluginErrors = [
        ...pluginValidation.triggers.filter(t => !t.isValid).flatMap(t => t.errors),
        ...pluginValidation.events.filter(e => !e.isValid).flatMap(e => e.errors)
      ];
      errors.push(...pluginErrors);

      // 6. 验证业务规则
      const businessRuleErrors = await this.validateBusinessRules(data, existingRule);
      errors.push(...businessRuleErrors);

      // 7. 生成警告
      const validationWarnings = this.generateWarnings(data, existingRule);
      warnings.push(...validationWarnings);

      return {
        isValid: errors.length === 0,
        errors,
        warnings,
        pluginValidations: pluginValidation
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Validation failed for rule ${ruleId}:`, error);
      errors.push(`Validation error: ${errorMessage}`);
      
      return {
        isValid: false,
        errors,
        warnings,
        pluginValidations: { triggers: [], events: [] }
      };
    }
  }

  /**
   * 验证规则存在性
   */
  private async validateRuleExists(ruleId: string) {
    return await this.prisma.automationRule.findUnique({
      where: { id: ruleId },
      select: {
        id: true,
        name: true,
        updatedAt: true,
        isEnabled: true
      }
    });
  }

  /**
   * 验证基础字段
   */
  private validateBasicFields(data: EnhancedUpdateData): string[] {
    const errors: string[] = [];

    // 验证名称
    if (data.name !== undefined) {
      if (!data.name || data.name.trim().length === 0) {
        errors.push('Rule name cannot be empty');
      } else if (data.name.length > 255) {
        errors.push('Rule name cannot exceed 255 characters');
      }
    }

    // 验证描述
    if (data.description !== undefined && data.description && data.description.length > 1000) {
      errors.push('Rule description cannot exceed 1000 characters');
    }

    // 验证优先级
    if (data.priority !== undefined) {
      if (data.priority < 0 || data.priority > 100) {
        errors.push('Rule priority must be between 0 and 100');
      }
    }

    // 验证标签
    if (data.tags !== undefined) {
      if (data.tags.length > 20) {
        errors.push('Cannot have more than 20 tags');
      }
      
      for (const tag of data.tags) {
        if (tag.length > 50) {
          errors.push(`Tag "${tag}" cannot exceed 50 characters`);
        }
      }
    }

    return errors;
  }

  /**
   * 验证名称唯一性
   */
  private async validateNameUniqueness(name: string, excludeRuleId: string): Promise<boolean> {
    const existingRule = await this.prisma.automationRule.findFirst({
      where: {
        name,
        id: { not: excludeRuleId }
      }
    });
    
    return !!existingRule;
  }

  /**
   * 验证版本控制
   */
  private validateVersion(currentUpdatedAt: Date, expectedVersion: number): boolean {
    return currentUpdatedAt.getTime() === expectedVersion;
  }

  /**
   * 验证插件配置
   */
  private async validatePluginConfigurations(data: EnhancedUpdateData) {
    const triggerValidations: PluginValidationResult[] = [];
    const eventValidations: PluginValidationResult[] = [];

    // 验证触发器插件
    if (data.triggers) {
      for (const trigger of data.triggers) {
        const validation = await this.validateTriggerPlugin(trigger);
        triggerValidations.push(validation);
      }
    }

    // 验证事件插件
    if (data.events) {
      for (const event of data.events) {
        const validation = await this.validateEventPlugin(event);
        eventValidations.push(validation);
      }
    }

    return {
      triggers: triggerValidations,
      events: eventValidations
    };
  }

  /**
   * 验证触发器插件
   */
  private async validateTriggerPlugin(trigger: CreateTriggerDto): Promise<PluginValidationResult> {
    const errors: string[] = [];
    
    // 检查插件是否存在
    const plugin = await this.prisma.pluginMetadata.findUnique({
      where: { id: trigger.pluginId }
    });

    const exists = !!plugin;
    const versionMatch = exists && plugin.version === trigger.pluginVersion;
    
    if (!exists) {
      errors.push(`Trigger plugin ${trigger.pluginId} not found`);
    } else if (!versionMatch) {
      errors.push(`Trigger plugin version mismatch. Expected: ${trigger.pluginVersion}, Found: ${plugin.version}`);
    }

    // 验证配置格式
    const configValid = await this.validateTriggerConfig(trigger.config, trigger.type);
    if (!configValid) {
      errors.push(`Invalid trigger configuration for type ${trigger.type}`);
    }

    return {
      pluginId: trigger.pluginId,
      pluginType: 'trigger',
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 验证事件插件
   */
  private async validateEventPlugin(event: CreateEventDto): Promise<PluginValidationResult> {
    const errors: string[] = [];
    
    // 检查插件是否存在
    const plugin = await this.prisma.pluginMetadata.findUnique({
      where: { id: event.pluginId }
    });

    const exists = !!plugin;
    const versionMatch = exists && plugin.version === event.pluginVersion;
    
    if (!exists) {
      errors.push(`Event plugin ${event.pluginId} not found`);
    } else if (!versionMatch) {
      errors.push(`Event plugin version mismatch. Expected: ${event.pluginVersion}, Found: ${plugin.version}`);
    }

    // 验证参数格式
    const configValid = await this.validateEventParams(event.params, event.type);
    if (!configValid) {
      errors.push(`Invalid event parameters for type ${event.type}`);
    }

    return {
      pluginId: event.pluginId,
      pluginType: 'event',
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * 验证触发器配置 (使用插件注册表和增强错误处理)
   */
  private async validateTriggerConfig(config: any, type: string): Promise<boolean> {
    try {
      // 通过插件注册表获取触发器插件
      const plugin = this.pluginRegistry.getTriggerPlugin(type);
      if (!plugin) {
        this.logger.warn(`No plugin found for trigger type: ${type}`);
        return false;
      }

      // 检查插件是否支持新的验证接口
      if ('validateConfig' in plugin && typeof plugin.validateConfig === 'function') {
        // 使用新的统一验证接口
        const validationResult = await (plugin as any).validateConfig({ type, config, enabled: true });

        if (!validationResult.isValid) {
          // 记录详细的验证错误
          this.logger.error(`Trigger validation failed for type '${type}':`, {
            pluginId: validationResult.metadata?.pluginId,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
            context: validationResult.metadata?.context
          });

          // 如果有警告，也记录下来
          if (validationResult.warnings && validationResult.warnings.length > 0) {
            this.logger.warn(`Trigger validation warnings for type '${type}':`, validationResult.warnings);
          }
        }

        return validationResult.isValid;
      } else {
        // 回退到旧的验证方法
        const triggerConfig = { type, config, enabled: true };
        return await plugin.validateTriggerConfig(triggerConfig);
      }
    } catch (error) {
      if (error instanceof PluginValidationError) {
        this.logger.error(`Plugin validation error for trigger type '${type}':`, {
          pluginId: error.pluginId,
          pluginVersion: error.pluginVersion,
          errors: error.validationErrors,
          warnings: error.validationWarnings,
          context: error.context
        });
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Unexpected error validating trigger config for type '${type}': ${errorMessage}`);
      }
      return false;
    }
  }

  /**
   * 验证事件参数 (使用插件注册表和增强错误处理)
   */
  private async validateEventParams(params: any, type: string): Promise<boolean> {
    try {
      // 通过插件注册表获取事件插件
      const plugin = this.pluginRegistry.getEventPlugin(type);
      if (!plugin) {
        this.logger.warn(`No plugin found for event type: ${type}`);
        return false;
      }

      // 检查插件是否支持新的验证接口
      if ('validateConfig' in plugin && typeof plugin.validateConfig === 'function') {
        // 使用新的统一验证接口
        const validationResult = await (plugin as any).validateConfig({ type, params, enabled: true });

        if (!validationResult.isValid) {
          // 记录详细的验证错误
          this.logger.error(`Event validation failed for type '${type}':`, {
            pluginId: validationResult.metadata?.pluginId,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
            context: validationResult.metadata?.context
          });

          // 如果有警告，也记录下来
          if (validationResult.warnings && validationResult.warnings.length > 0) {
            this.logger.warn(`Event validation warnings for type '${type}':`, validationResult.warnings);
          }
        }

        return validationResult.isValid;
      } else {
        // 回退到旧的验证方法
        const eventConfig = { type, params, enabled: true };
        return await plugin.validateEventConfig(eventConfig);
      }
    } catch (error) {
      if (error instanceof PluginValidationError) {
        this.logger.error(`Plugin validation error for event type '${type}':`, {
          pluginId: error.pluginId,
          pluginVersion: error.pluginVersion,
          errors: error.validationErrors,
          warnings: error.validationWarnings,
          context: error.context
        });
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Unexpected error validating event params for type '${type}': ${errorMessage}`);
      }
      return false;
    }
  }

  // 硬编码验证方法已移除，现在使用插件注册表进行动态验证

  /**
   * 验证业务规则
   */
  private async validateBusinessRules(data: EnhancedUpdateData, _existingRule: any): Promise<string[]> {
    const errors: string[] = [];

    // 验证规则不能同时有多个相同类型的触发器
    if (data.triggers) {
      const triggerTypes = data.triggers.map((t: any) => t.type);
      const duplicateTypes = triggerTypes.filter((type: string, index: number) => triggerTypes.indexOf(type) !== index);
      if (duplicateTypes.length > 0) {
        errors.push(`Duplicate trigger types found: ${duplicateTypes.join(', ')}`);
      }
    }

    // 验证至少有一个触发器和一个事件
    if (data.triggers && data.triggers.length === 0) {
      errors.push('Rule must have at least one trigger');
    }
    
    if (data.events && data.events.length === 0) {
      errors.push('Rule must have at least one event');
    }

    return errors;
  }

  /**
   * 生成警告信息
   */
  private generateWarnings(data: EnhancedUpdateData, existingRule: any): string[] {
    const warnings: string[] = [];

    // 检查是否禁用了规则
    if (data.isEnabled === false && existingRule.isEnabled === true) {
      warnings.push('Rule will be disabled and stop executing');
    }

    // 检查是否更改了关键配置
    if (data.triggers && data.triggers.length > 0) {
      warnings.push('Trigger configuration changes will affect rule execution schedule');
    }

    return warnings;
  }
}
