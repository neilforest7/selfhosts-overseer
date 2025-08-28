"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export type ComboboxOption = {
  value: string
  label: string
  group?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyPlaceholder?: string
}

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyPlaceholder = "No options found.",
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)

  const groupedOptions = React.useMemo(() => {
    return options.reduce((acc, option) => {
      const group = option.group || "general"
      if (!acc[group]) {
        acc[group] = []
      }
      acc[group].push(option)
      return acc
    }, {} as Record<string, ComboboxOption[]>)
  }, [options])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          {value
            ? options.find((option) => option.value === value)?.label
            : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyPlaceholder}</CommandEmpty>
            {Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
              <CommandGroup key={groupName} heading={groupName === 'general' ? undefined : groupName}>
                {groupOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label} // Search is based on label
                    onSelect={() => {
                      onChange(option.value === value ? "" : option.value)
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === option.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}