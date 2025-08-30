'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronsUpDown, X } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
}

interface MultiSelectHostsProps {
  options: ComboboxOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  isLoading?: boolean;
}

export function MultiSelectHosts({
  options,
  value,
  onChange,
  placeholder = "Select hosts...",
  isLoading = false
}: MultiSelectHostsProps) {
  const [open, setOpen] = useState(false);

  const handleSelectAll = () => {
    if (value.length === options.length) {
      // 如果已全选，则取消全选
      onChange([]);
    } else {
      // 否则全选
      onChange(options.map(option => option.value));
    }
  };

  const handleToggle = (optionValue: string) => {
    const newValue = value.includes(optionValue)
      ? value.filter(v => v !== optionValue)
      : [...value, optionValue];
    onChange(newValue);
  };

  const handleRemove = (optionValue: string) => {
    onChange(value.filter(v => v !== optionValue));
  };

  const selectedOptions = options.filter(option => value.includes(option.value));
  const isAllSelected = value.length === options.length && options.length > 0;
  const isPartialSelected = value.length > 0 && value.length < options.length;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between"
            disabled={isLoading}
          >
            {value.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : (
              <span>{value.length} host{value.length > 1 ? 's' : ''} selected</span>
            )}
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <div className="p-2 space-y-2">
            {/* 全选/取消全选 */}
            <div className="flex items-center space-x-2 pb-2 pl-1">
              <Checkbox
                checked={isAllSelected}
                ref={(el) => {
                  if (el) {
                    const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
                    if (checkbox) checkbox.indeterminate = isPartialSelected;
                  }
                }}
                onCheckedChange={handleSelectAll}
              />
              <span className="text-sm font-medium">
                {isAllSelected ? 'Deselect All' : 'Select All'} ({options.length})
              </span>
            </div>

            {/* 主机列表 */}
            <ScrollArea className="max-h-48">
              <div className="space-y-1">
                {isLoading ? (
                  <div className="text-sm text-muted-foreground p-2">Loading...</div>
                ) : options.length === 0 ? (
                  <div className="text-sm text-muted-foreground p-2">No hosts found</div>
                ) : (
                  options.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2 p-1 rounded hover:bg-muted">
                      <Checkbox
                        checked={value.includes(option.value)}
                        onCheckedChange={() => handleToggle(option.value)}
                      />
                      <span className="text-sm flex-1">{option.label}</span>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </PopoverContent>
      </Popover>

      {/* 已选择的主机标签 */}
      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedOptions.map((option) => (
            <Badge key={option.value} variant="secondary" className="text-xs">
              {option.label}
              <button
                type="button"
                className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5"
                onClick={() => handleRemove(option.value)}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
