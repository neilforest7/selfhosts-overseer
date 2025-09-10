"use client";

import { useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Terminal, 
  Server, 
  Container, 
  HardDrive, 
  Activity, 
  Network, 
  FileText,
  Copy,
  Play
} from 'lucide-react';

interface CommandTemplate {
  id: string;
  name: string;
  description: string;
  command: string;
  category: string;
  icon: React.ReactNode;
  variables?: string[];
}

const COMMAND_TEMPLATES: CommandTemplate[] = [
  {
    id: 'system-info',
    name: 'System Information',
    description: 'Get comprehensive system information',
    command: 'uname -a && uptime && free -h && df -h',
    category: 'system',
    icon: <Server className="h-4 w-4" />,
  },
  {
    id: 'docker-status',
    name: 'Docker Status',
    description: 'Check Docker containers and images',
    command: 'docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}" && echo "\\n--- Images ---" && docker images --format "table {{.Repository}}\\t{{.Tag}}\\t{{.Size}}"',
    category: 'docker',
    icon: <Container className="h-4 w-4" />,
  },
  {
    id: 'service-status',
    name: 'Service Status',
    description: 'Check systemd service status',
    command: 'systemctl status {{SERVICE_NAME}}',
    category: 'system',
    icon: <Activity className="h-4 w-4" />,
    variables: ['SERVICE_NAME'],
  },
  {
    id: 'disk-usage',
    name: 'Disk Usage Analysis',
    description: 'Analyze disk usage and find large files',
    command: 'df -h && echo "\\n--- Top 10 largest directories ---" && du -h / 2>/dev/null | sort -rh | head -10',
    category: 'system',
    icon: <HardDrive className="h-4 w-4" />,
  },
  {
    id: 'memory-usage',
    name: 'Memory Usage',
    description: 'Check memory usage and top processes',
    command: 'free -h && echo "\\n--- Top memory consumers ---" && ps aux --sort=-%mem | head -10',
    category: 'system',
    icon: <Activity className="h-4 w-4" />,
  },
  {
    id: 'process-list',
    name: 'Process List',
    description: 'List running processes with resource usage',
    command: 'ps aux --sort=-%cpu | head -20',
    category: 'system',
    icon: <Terminal className="h-4 w-4" />,
  },
  {
    id: 'network-status',
    name: 'Network Status',
    description: 'Check network interfaces and connections',
    command: 'ip addr show && echo "\\n--- Active connections ---" && ss -tuln',
    category: 'network',
    icon: <Network className="h-4 w-4" />,
  },
  {
    id: 'log-tail',
    name: 'Tail System Logs',
    description: 'Show recent system log entries',
    command: 'journalctl -n 50 --no-pager',
    category: 'logs',
    icon: <FileText className="h-4 w-4" />,
  },
  {
    id: 'docker-cleanup',
    name: 'Docker Cleanup',
    description: 'Clean up unused Docker resources',
    command: 'docker system prune -f && docker volume prune -f',
    category: 'docker',
    icon: <Container className="h-4 w-4" />,
  },
  {
    id: 'container-logs',
    name: 'Container Logs',
    description: 'Show logs for a specific container',
    command: 'docker logs --tail 100 {{CONTAINER_NAME}}',
    category: 'docker',
    icon: <Container className="h-4 w-4" />,
    variables: ['CONTAINER_NAME'],
  },
];

interface CommandTemplateSelectorProps {
  value: string;
  onChange: (command: string) => void;
  onTemplateChange?: (templateId: string) => void;
}

export function CommandTemplateSelector({ 
  value, 
  onChange, 
  onTemplateChange 
}: CommandTemplateSelectorProps) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('custom');
  const [variables, setVariables] = useState<Record<string, string>>({});

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    onTemplateChange?.(templateId);
    
    if (templateId === 'custom') {
      return;
    }

    const template = COMMAND_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      let command = template.command;
      
      // Initialize variables if template has them
      if (template.variables) {
        const newVariables: Record<string, string> = {};
        template.variables.forEach(variable => {
          newVariables[variable] = variables[variable] || '';
        });
        setVariables(newVariables);
      }
      
      onChange(command);
    }
  };

  const handleVariableChange = (variable: string, value: string) => {
    const newVariables = { ...variables, [variable]: value };
    setVariables(newVariables);
    
    // Update command with new variable values
    const template = COMMAND_TEMPLATES.find(t => t.id === selectedTemplate);
    if (template) {
      let command = template.command;
      Object.entries(newVariables).forEach(([key, val]) => {
        command = command.replace(new RegExp(`{{${key}}}`, 'g'), val);
      });
      onChange(command);
    }
  };

  const selectedTemplateData = COMMAND_TEMPLATES.find(t => t.id === selectedTemplate);
  const categories = [...new Set(COMMAND_TEMPLATES.map(t => t.category))];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Command Template</Label>
        <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a command template" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                Custom Command
              </div>
            </SelectItem>
            {categories.map(category => (
              <div key={category}>
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">
                  {category}
                </div>
                {COMMAND_TEMPLATES
                  .filter(t => t.category === category)
                  .map(template => (
                    <SelectItem key={template.id} value={template.id}>
                      <div className="flex items-center gap-2">
                        {template.icon}
                        <div>
                          <div>{template.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {template.description}
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
              </div>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Template Variables */}
      {selectedTemplateData?.variables && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Template Variables</CardTitle>
            <CardDescription>
              Fill in the required variables for this command template
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedTemplateData.variables.map(variable => (
              <div key={variable} className="space-y-1">
                <Label className="text-xs">{variable}</Label>
                <input
                  type="text"
                  className="w-full px-3 py-1 text-sm border rounded"
                  placeholder={`Enter ${variable.toLowerCase().replace('_', ' ')}`}
                  value={variables[variable] || ''}
                  onChange={(e) => handleVariableChange(variable, e.target.value)}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Command Preview/Editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Command</Label>
          {selectedTemplate !== 'custom' && (
            <Badge variant="outline" className="text-xs">
              {selectedTemplateData?.name}
            </Badge>
          )}
        </div>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter shell command or select a template above"
          className="font-mono text-sm"
          rows={4}
        />
      </div>

      {/* Template Info */}
      {selectedTemplateData && selectedTemplate !== 'custom' && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              {selectedTemplateData.icon}
              <div className="flex-1">
                <h4 className="font-medium">{selectedTemplateData.name}</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedTemplateData.description}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
