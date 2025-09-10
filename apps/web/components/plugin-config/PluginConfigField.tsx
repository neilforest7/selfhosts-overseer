"use client";

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/tooltip';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  HelpCircle,
  Plus,
  Minus,
  Clock,
  Calendar,
  FolderOpen,
  Server,
  Container,
  User,
  Check,
  ChevronsUpDown
} from 'lucide-react';
import { FilePathSelector } from './FilePathSelector';

interface PluginConfigFieldProps {
  fieldKey: string;
  schema: any;
  value: any;
  onChange: (value: any) => void;
  error?: string;
  // Additional context for enhanced UI
  availableHosts?: Array<{ id: string; name: string }>;
  availableContainers?: Array<{ id: string; name: string; hostName: string }>;
  availableUsers?: Array<{ id: string; name: string }>;
}

export function PluginConfigField({
  fieldKey,
  schema,
  value,
  onChange,
  error,
  availableHosts = [],
  availableContainers = [],
  availableUsers = []
}: PluginConfigFieldProps) {
  const [arrayItems, setArrayItems] = useState<string[]>(
    Array.isArray(value) ? value : []
  );
  const [multiSelectOpen, setMultiSelectOpen] = useState(false);

  const handleArrayChange = (items: string[]) => {
    setArrayItems(items);
    onChange(items);
  };

  const addArrayItem = () => {
    const newItems = [...arrayItems, ''];
    handleArrayChange(newItems);
  };

  const removeArrayItem = (index: number) => {
    const newItems = arrayItems.filter((_, i) => i !== index);
    handleArrayChange(newItems);
  };

  const updateArrayItem = (index: number, newValue: string) => {
    const newItems = [...arrayItems];
    newItems[index] = newValue;
    handleArrayChange(newItems);
  };

  const renderField = () => {
    // Enhanced UI based on field semantics
    const fieldName = fieldKey.toLowerCase();
    const title = schema.title || fieldKey;
    const description = schema.description;
    const placeholder = schema.placeholder || schema.examples?.[0];

    // Special handling for path fields
    if (fieldName.includes('path') || fieldName.includes('directory') || fieldName.includes('file')) {
      return (
        <FilePathSelector
          value={typeof value === 'string' ? value : ''}
          onChange={onChange}
          type={fieldName.includes('directory') ? 'directory' : fieldName.includes('file') ? 'file' : 'both'}
          placeholder={placeholder}
          label={title}
          description={description}
        />
      );
    }

    // Special handling for common field types
    if (fieldName.includes('host') && fieldName.includes('id')) {
      // Handle both single and array selections
      if (schema.type === 'array' || fieldName.includes('ids')) {
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <Popover open={multiSelectOpen} onOpenChange={setMultiSelectOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={multiSelectOpen}
                className="w-full justify-between"
              >
                {selectedValues.length > 0
                  ? `已选择 ${selectedValues.length} 个主机`
                  : '选择主机'}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0">
              <Command>
                <CommandInput placeholder="搜索主机..." />
                <CommandEmpty>未找到主机</CommandEmpty>
                <CommandGroup>
                  {availableHosts.map((host) => (
                    <CommandItem
                      key={host.id}
                      onSelect={() => {
                        const newValues = selectedValues.includes(host.id)
                          ? selectedValues.filter(v => v !== host.id)
                          : [...selectedValues, host.id];
                        onChange(newValues);
                      }}
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${
                          selectedValues.includes(host.id) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <div className="flex items-center gap-2">
                        <Server className="h-4 w-4" />
                        <div>
                          <div>{host.name}</div>
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>
        );
      }
      
      // Single selection
      const selectValue = typeof value === 'object' ? value?.id || value?.value || '' : String(value || '');
      
      return (
        <Select value={selectValue} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="选择主机" />
          </SelectTrigger>
          <SelectContent>
            {availableHosts.map((host) => (
              <SelectItem key={host.id} value={host.id}>
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4" />
                  {host.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (fieldName.includes('container') && (fieldName.includes('id') || fieldName.includes('identifier'))) {
      // Handle both single and array selections
      if (schema.type === 'array' || fieldName.includes('ids')) {
        const selectedValues = Array.isArray(value) ? value : [];
        return (
          <Popover open={multiSelectOpen} onOpenChange={setMultiSelectOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={multiSelectOpen}
                className="w-full justify-between"
              >
                {selectedValues.length > 0
                  ? `已选择 ${selectedValues.length} 个容器`
                  : '选择容器'}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0">
              <Command >
                <CommandInput placeholder="搜索容器..." />
                <CommandEmpty>未找到容器</CommandEmpty>
                <CommandGroup>
                  {availableContainers.map((container) => (
                    <CommandItem
                      key={container.id}
                      onSelect={() => {
                        const newValues = selectedValues.includes(container.id)
                          ? selectedValues.filter(v => v !== container.id)
                          : [...selectedValues, container.id];
                        onChange(newValues);
                      }}
                    >
                      <Check
                        className={`h-4 w-4 ${
                          selectedValues.includes(container.id) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <div className="flex items-center gap-2">
                        <Container className="h-4 w-4" />
                        <div>
                          <div>{container.name}</div>
                          {container.hostName && (
                            <div className="text-xs text-muted-foreground">
                              {container.hostName}
                            </div>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Command>
            </PopoverContent>
          </Popover>
        );
      }
      
      // Single selection
      const selectValue = typeof value === 'object' ? value?.id || value?.value || '' : String(value || '');
      
      return (
        <Select value={selectValue} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="选择容器" />
          </SelectTrigger>
          <SelectContent>
            {availableContainers.map((container) => (
              <SelectItem key={container.id} value={container.id}>
                <div className="flex items-center gap-2">
                  <Container className="h-4 w-4" />
                  <div>
                    <div>{container.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {container.hostName}
                    </div>
                  </div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (fieldName.includes('user') || fieldName === 'allowedusers') {
      // Ensure value is a scalar string for Select component
      const selectValue = typeof value === 'object' ? value?.id || value?.value || '' : String(value || '');
      
      return (
        <Select value={selectValue} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="选择用户" />
          </SelectTrigger>
          <SelectContent>
            {availableUsers.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  {user.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    // Handle different schema types
    switch (schema.type) {
      case 'boolean':
        return (
          <div className="flex items-center space-x-2">
            <Switch
              checked={value || false}
              onCheckedChange={onChange}
            />
            <Label>{value ? '启用' : '禁用'}</Label>
          </div>
        );

      case 'number':
      case 'integer':
        // Use slider for values with min/max
        if (schema.minimum !== undefined && schema.maximum !== undefined) {
          return (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {schema.minimum}
                </span>
                <Badge variant="outline">{value || schema.default || schema.minimum}</Badge>
                <span className="text-sm text-muted-foreground">
                  {schema.maximum}
                </span>
              </div>
              <Slider
                value={[value || schema.default || schema.minimum]}
                onValueChange={(values) => onChange(values[0])}
                min={schema.minimum}
                max={schema.maximum}
                step={schema.multipleOf || 1}
                className="w-full"
              />
            </div>
          );
        }
        
        return (
          <Input
            type="number"
            value={value || ''}
            onChange={(e) => onChange(
              schema.type === 'integer' 
                ? parseInt(e.target.value) || 0
                : parseFloat(e.target.value) || 0
            )}
            placeholder={placeholder}
            min={schema.minimum}
            max={schema.maximum}
            step={schema.multipleOf || (schema.type === 'integer' ? 1 : 0.1)}
          />
        );

      case 'string':
        // Handle enums as select dropdowns
        if (schema.enum) {
          return (
            <Select value={value || ''} onValueChange={onChange}>
              <SelectTrigger>
                <SelectValue placeholder={`选择${title}`} />
              </SelectTrigger>
              <SelectContent>
                {schema.enum.map((option: string) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }

        // Handle multiline text
        if (schema.format === 'textarea' || (schema.maxLength && schema.maxLength > 100)) {
          return (
            <Textarea
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              rows={4}
            />
          );
        }

        // Handle special formats
        if (schema.format === 'password') {
          return (
            <Input
              type="password"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
            />
          );
        }

        if (schema.format === 'email') {
          return (
            <Input
              type="email"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
            />
          );
        }

        if (schema.format === 'uri' || fieldName.includes('url')) {
          return (
            <Input
              type="url"
              value={value || ''}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder || 'https://example.com'}
            />
          );
        }

        // Default string input
        return (
          <Input
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
          />
        );

      case 'array':
        // Handle enum arrays as multi-select
        if (schema.items?.enum) {
          const selectedValues = Array.isArray(value) ? value : [];
          return (
            <Popover open={multiSelectOpen} onOpenChange={setMultiSelectOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={multiSelectOpen}
                  className="w-full justify-between"
                >
                  {selectedValues.length > 0
                    ? `已选择 ${selectedValues.length} 项`
                    : `选择${title}`}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-full p-0">
                <Command>
                  <CommandInput placeholder={`搜索${title}...`} />
                  <CommandEmpty>未找到选项</CommandEmpty>
                  <CommandGroup>
                    {schema.items.enum.map((option: string) => (
                      <CommandItem
                        key={option}
                        onSelect={() => {
                          const newValues = selectedValues.includes(option)
                            ? selectedValues.filter(v => v !== option)
                            : [...selectedValues, option];
                          onChange(newValues);
                        }}
                      >
                        <Check
                          className={`mr-2 h-4 w-4 ${
                            selectedValues.includes(option) ? "opacity-100" : "opacity-0"
                          }`}
                        />
                        {option}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          );
        }

        // Default array input
        return (
          <div className="space-y-2">
            {arrayItems.map((item, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  value={item}
                  onChange={(e) => updateArrayItem(index, e.target.value)}
                  placeholder={`${title} ${index + 1}`}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => removeArrayItem(index)}
                >
                  <Minus className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addArrayItem}
            >
              <Plus className="h-4 w-4 mr-2" />
              添加项目
            </Button>
          </div>
        );

      default:
        // Fallback to JSON input
        return (
          <Textarea
            value={typeof value === 'string' ? value : JSON.stringify(value || '', null, 2)}
            onChange={(e) => {
              try {
                onChange(JSON.parse(e.target.value));
              } catch {
                onChange(e.target.value);
              }
            }}
            placeholder="JSON 格式"
            rows={3}
          />
        );
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label htmlFor={fieldKey}>
          {schema.title || fieldKey}
          {schema.required && <span className="text-red-500">*</span>}
        </Label>
        {schema.description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{schema.description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      
      {renderField()}
      
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
      
      {schema.examples && schema.examples.length > 0 && !error && (
        <p className="text-xs text-muted-foreground">
          示例: {Array.isArray(schema.examples) ? schema.examples.join(', ') : schema.examples}
        </p>
      )}
    </div>
  );
}
