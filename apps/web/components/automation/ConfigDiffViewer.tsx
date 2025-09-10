"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  ArrowRight, 
  Plus, 
  Minus, 
  Edit, 
  Clock, 
  User, 
  FileText,
  Settings,
  Zap,
  Play
} from 'lucide-react';

export interface ConfigDiff {
  field: string;
  oldValue: any;
  newValue: any;
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
}

export interface AuditLogEntry {
  id: string;
  title: string;
  status: 'COMPLETED' | 'ERROR';
  startTime: string;
  endTime?: string;
  triggerContext: {
    operationType: 'CREATE' | 'UPDATE' | 'DELETE';
    changedFields: string[];
    triggersChanged: boolean;
    eventsChanged: boolean;
    notificationsChanged: boolean;
    configDiffs: ConfigDiff[];
    duration: number;
  };
}

interface Props {
  auditEntry: AuditLogEntry;
  showFullDiff?: boolean;
}

export function ConfigDiffViewer({ auditEntry, showFullDiff = false }: Props) {
  const { triggerContext } = auditEntry;
  const { configDiffs, changedFields, duration } = triggerContext;

  const getChangeIcon = (changeType: string) => {
    switch (changeType) {
      case 'ADDED':
        return <Plus className="h-4 w-4 text-green-600" />;
      case 'REMOVED':
        return <Minus className="h-4 w-4 text-red-600" />;
      case 'MODIFIED':
        return <Edit className="h-4 w-4 text-blue-600" />;
      default:
        return <Edit className="h-4 w-4 text-gray-600" />;
    }
  };

  const getChangeColor = (changeType: string) => {
    switch (changeType) {
      case 'ADDED':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'REMOVED':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'MODIFIED':
        return 'bg-blue-50 border-blue-200 text-blue-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) {
      return '(空)';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const getFieldIcon = (field: string) => {
    if (field.includes('trigger')) {
      return <Zap className="h-4 w-4 text-yellow-600" />;
    }
    if (field.includes('event')) {
      return <Play className="h-4 w-4 text-green-600" />;
    }
    if (field.includes('notification')) {
      return <FileText className="h-4 w-4 text-purple-600" />;
    }
    return <Settings className="h-4 w-4 text-gray-600" />;
  };

  const basicFieldDiffs = configDiffs.filter(diff => 
    !diff.field.includes('[') && !diff.field.includes('.')
  );

  const nestedFieldDiffs = configDiffs.filter(diff => 
    diff.field.includes('[') || diff.field.includes('.')
  );

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Clock className="h-5 w-5 text-gray-500" />
            <CardTitle className="text-lg">配置变更详情</CardTitle>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className="text-xs">
              {duration}ms
            </Badge>
            <Badge 
              variant={auditEntry.status === 'COMPLETED' ? 'default' : 'destructive'}
              className="text-xs"
            >
              {auditEntry.status}
            </Badge>
          </div>
        </div>
        <CardDescription>
          {new Date(auditEntry.startTime).toLocaleString('zh-CN')}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 变更概览 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900">{changedFields.length}</div>
            <div className="text-sm text-gray-600">变更字段</div>
          </div>
          <div className="text-center p-3 bg-yellow-50 rounded-lg">
            <div className="text-2xl font-bold text-yellow-900">
              {triggerContext.triggersChanged ? '1' : '0'}
            </div>
            <div className="text-sm text-yellow-700">触发器变更</div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-900">
              {triggerContext.eventsChanged ? '1' : '0'}
            </div>
            <div className="text-sm text-green-700">事件变更</div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-2xl font-bold text-purple-900">
              {triggerContext.notificationsChanged ? '1' : '0'}
            </div>
            <div className="text-sm text-purple-700">通知变更</div>
          </div>
        </div>

        <Separator />

        {/* 基础字段变更 */}
        {basicFieldDiffs.length > 0 && (
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-900 flex items-center space-x-2">
              <Settings className="h-4 w-4" />
              <span>基础字段变更</span>
            </h4>
            <div className="space-y-2">
              {basicFieldDiffs.map((diff, index) => (
                <div 
                  key={index}
                  className={`p-3 rounded-lg border ${getChangeColor(diff.changeType)}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      {getChangeIcon(diff.changeType)}
                      {getFieldIcon(diff.field)}
                      <span className="font-medium">{diff.field}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {diff.changeType}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center space-x-2 text-sm">
                    {diff.changeType !== 'ADDED' && (
                      <div className="flex-1">
                        <div className="text-xs text-gray-600 mb-1">旧值:</div>
                        <code className="bg-white/50 px-2 py-1 rounded text-xs">
                          {formatValue(diff.oldValue)}
                        </code>
                      </div>
                    )}
                    
                    {diff.changeType === 'MODIFIED' && (
                      <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    )}
                    
                    {diff.changeType !== 'REMOVED' && (
                      <div className="flex-1">
                        <div className="text-xs text-gray-600 mb-1">新值:</div>
                        <code className="bg-white/50 px-2 py-1 rounded text-xs">
                          {formatValue(diff.newValue)}
                        </code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 嵌套配置变更 */}
        {nestedFieldDiffs.length > 0 && showFullDiff && (
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-900 flex items-center space-x-2">
              <FileText className="h-4 w-4" />
              <span>配置详情变更</span>
            </h4>
            <ScrollArea className="h-64">
              <div className="space-y-2 pr-4">
                {nestedFieldDiffs.map((diff, index) => (
                  <div 
                    key={index}
                    className={`p-3 rounded-lg border ${getChangeColor(diff.changeType)}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        {getChangeIcon(diff.changeType)}
                        {getFieldIcon(diff.field)}
                        <span className="font-mono text-sm">{diff.field}</span>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {diff.changeType}
                      </Badge>
                    </div>
                    
                    <div className="space-y-2 text-sm">
                      {diff.changeType !== 'ADDED' && (
                        <div>
                          <div className="text-xs text-gray-600 mb-1">旧值:</div>
                          <pre className="bg-white/50 px-2 py-1 rounded text-xs overflow-x-auto">
                            {formatValue(diff.oldValue)}
                          </pre>
                        </div>
                      )}
                      
                      {diff.changeType !== 'REMOVED' && (
                        <div>
                          <div className="text-xs text-gray-600 mb-1">新值:</div>
                          <pre className="bg-white/50 px-2 py-1 rounded text-xs overflow-x-auto">
                            {formatValue(diff.newValue)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* 变更字段列表 */}
        <div className="space-y-2">
          <h4 className="font-semibold text-gray-900">变更字段列表</h4>
          <div className="flex flex-wrap gap-2">
            {changedFields.map((field, index) => (
              <Badge key={index} variant="secondary" className="text-xs">
                {field}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
