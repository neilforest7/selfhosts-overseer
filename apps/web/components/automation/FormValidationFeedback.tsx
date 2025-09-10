"use client";

import React, { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  Info, 
  Loader2,
  Eye,
  EyeOff
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfigSerializer, type PluginConfig } from '@/lib/utils/config-serializer';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export interface ConfigPreview {
  triggerConfig: PluginConfig;
  eventConfig: PluginConfig;
  isValid: boolean;
  serializedSize: number;
}

interface Props {
  formData: any;
  triggerPlugin?: any;
  eventPlugin?: any;
  isSubmitting?: boolean;
  onValidationChange?: (result: ValidationResult) => void;
}

export function FormValidationFeedback({ 
  formData, 
  triggerPlugin, 
  eventPlugin, 
  isSubmitting = false,
  onValidationChange 
}: Props) {
  const [validation, setValidation] = useState<ValidationResult>({
    isValid: true,
    errors: [],
    warnings: [],
    suggestions: []
  });
  
  const [configPreview, setConfigPreview] = useState<ConfigPreview | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [validationProgress, setValidationProgress] = useState(0);

  // 实时验证
  useEffect(() => {
    const validateForm = async () => {
      setValidationProgress(0);
      const errors: string[] = [];
      const warnings: string[] = [];
      const suggestions: string[] = [];

      // 基础字段验证
      setValidationProgress(20);
      if (!formData.name || formData.name.trim().length === 0) {
        errors.push('规则名称不能为空');
      } else if (formData.name.length > 255) {
        errors.push('规则名称不能超过255个字符');
      }

      if (formData.description && formData.description.length > 1000) {
        warnings.push('描述过长，建议控制在1000字符以内');
      }

      // 触发器验证
      setValidationProgress(40);
      if (!formData.triggerType) {
        errors.push('请选择触发器类型');
      } else {
        const triggerConfig = ConfigSerializer.cleanConfig(
          ConfigSerializer['extractNestedConfig'](formData, 'triggerConfig')
        );

        if (triggerPlugin?.configSchema) {
          const triggerValidation = ConfigSerializer.validateConfig(
            triggerConfig, 
            triggerPlugin.configSchema
          );
          
          if (!triggerValidation.isValid) {
            errors.push(...triggerValidation.errors.map(e => `触发器配置: ${e}`));
          }
        }

        // 特殊验证规则
        if (formData.triggerType === 'cron' && triggerConfig.expression) {
          if (!isValidCronExpression(triggerConfig.expression)) {
            errors.push('CRON表达式格式不正确');
          } else {
            suggestions.push('CRON表达式验证通过');
          }
        }
      }

      // 事件验证
      setValidationProgress(60);
      if (!formData.eventType) {
        errors.push('请选择事件类型');
      } else {
        const eventConfig = ConfigSerializer.cleanConfig(
          ConfigSerializer['extractNestedConfig'](formData, 'eventConfig')
        );

        if (eventPlugin?.configSchema) {
          const eventValidation = ConfigSerializer.validateConfig(
            eventConfig, 
            eventPlugin.configSchema
          );
          
          if (!eventValidation.isValid) {
            errors.push(...eventValidation.errors.map(e => `事件配置: ${e}`));
          }
        }

        // 特殊验证规则
        if (formData.eventType === 'execute-command' && eventConfig.command) {
          if (eventConfig.command.includes('rm -rf') || eventConfig.command.includes('sudo')) {
            warnings.push('检测到潜在危险命令，请谨慎使用');
          }
        }
      }

      // 生成配置预览
      setValidationProgress(80);
      if (formData.triggerType && formData.eventType) {
        try {
          const triggerConfig = ConfigSerializer['extractNestedConfig'](formData, 'triggerConfig');
          const eventConfig = ConfigSerializer['extractNestedConfig'](formData, 'eventConfig');
          
          const serializedTrigger = JSON.stringify(triggerConfig);
          const serializedEvent = JSON.stringify(eventConfig);
          const totalSize = serializedTrigger.length + serializedEvent.length;

          setConfigPreview({
            triggerConfig,
            eventConfig,
            isValid: errors.length === 0,
            serializedSize: totalSize
          });

          if (totalSize > 10000) {
            warnings.push('配置数据较大，可能影响性能');
          }

          suggestions.push(`配置数据大小: ${totalSize} 字符`);
        } catch (e) {
          errors.push('配置序列化失败');
        }
      }

      setValidationProgress(100);

      const result: ValidationResult = {
        isValid: errors.length === 0,
        errors,
        warnings,
        suggestions
      };

      setValidation(result);
      onValidationChange?.(result);
    };

    const debounceTimer = setTimeout(validateForm, 300);
    return () => clearTimeout(debounceTimer);
  }, [formData, triggerPlugin, eventPlugin, onValidationChange]);

  const getValidationIcon = () => {
    if (isSubmitting) {
      return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />;
    }
    if (validation.errors.length > 0) {
      return <XCircle className="h-5 w-5 text-red-600" />;
    }
    if (validation.warnings.length > 0) {
      return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
    }
    return <CheckCircle className="h-5 w-5 text-green-600" />;
  };

  const getValidationStatus = () => {
    if (isSubmitting) return '提交中...';
    if (validation.errors.length > 0) return '验证失败';
    if (validation.warnings.length > 0) return '有警告';
    return '验证通过';
  };

  return (
    <div className="space-y-4">
      {/* 验证状态概览 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {getValidationIcon()}
              <CardTitle className="text-sm">{getValidationStatus()}</CardTitle>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="text-xs">
                {validation.errors.length} 错误
              </Badge>
              <Badge variant="outline" className="text-xs">
                {validation.warnings.length} 警告
              </Badge>
            </div>
          </div>
          {isSubmitting && (
            <Progress value={validationProgress} className="h-1" />
          )}
        </CardHeader>

        {(validation.errors.length > 0 || validation.warnings.length > 0 || validation.suggestions.length > 0) && (
          <CardContent className="space-y-3">
            {/* 错误信息 */}
            {validation.errors.length > 0 && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    {validation.errors.map((error, index) => (
                      <div key={index} className="text-sm">• {error}</div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* 警告信息 */}
            {validation.warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    {validation.warnings.map((warning, index) => (
                      <div key={index} className="text-sm">• {warning}</div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* 建议信息 */}
            {validation.suggestions.length > 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1">
                    {validation.suggestions.map((suggestion, index) => (
                      <div key={index} className="text-sm">• {suggestion}</div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        )}
      </Card>

      {/* 配置预览 */}
      {configPreview && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">配置预览</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
                className="h-8 px-2"
              >
                {showPreview ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                <span className="ml-1">{showPreview ? '隐藏' : '显示'}</span>
              </Button>
            </div>
            <CardDescription>
              数据大小: {configPreview.serializedSize} 字符
            </CardDescription>
          </CardHeader>

          {showPreview && (
            <CardContent className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-2">触发器配置</h4>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                  {JSON.stringify(configPreview.triggerConfig, null, 2)}
                </pre>
              </div>
              
              <div>
                <h4 className="text-sm font-medium mb-2">事件配置</h4>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto">
                  {JSON.stringify(configPreview.eventConfig, null, 2)}
                </pre>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

// 辅助函数：验证CRON表达式
function isValidCronExpression(expression: string): boolean {
  if (!expression || typeof expression !== 'string') return false;
  
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  
  // 简单的CRON表达式验证
  const cronRegex = /^[0-9*,/-]+$/;
  return parts.every(part => cronRegex.test(part));
}
