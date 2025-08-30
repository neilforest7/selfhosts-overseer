"use client";

import { useEffect } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, PlusCircle } from 'lucide-react';
import { AutomationRule } from './AutomationsSection';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuery } from '@tanstack/react-query';
import { Combobox, ComboboxOption } from '@/components/ui/combobox';

// --- API Fetchers ---
async function fetchHosts(): Promise<{ id: string; name: string }[]> {
  const r = await fetch('/api/v1/hosts');
  if (!r.ok) throw new Error('Failed to fetch hosts');
  const data = await r.json();
  const result = data.items || data;
  return Array.isArray(result) ? result : [];
}

async function fetchContainers(): Promise<{ id: string; name: string; host: { name: string } }[]> {
  const r = await fetch('/api/v1/containers');
  if (!r.ok) throw new Error('Failed to fetch containers');
  const data = await r.json();
  const result = data.items || data;
  return Array.isArray(result) ? result : [];
}


// --- Rule Builder Configuration ---
const FACTS_DEFINITIONS = {
  'container-status': {
    label: 'Container Status',
    operators: ['equal', 'notEqual'],
    valueType: 'select',
    valueOptions: ['running', 'exited', 'restarting', 'paused'],
    param: { name: 'containerId', label: 'Container', type: 'combobox', optionsKey: 'containers' },
    factPath: '$.state',
  },
  // Add more fact definitions here e.g. 'cpu-usage', 'host-status'
};

const EVENTS_DEFINITIONS = {
  'restart-container': {
    label: 'Restart Container',
    params: [{ name: 'containerId', label: 'Container', type: 'combobox', optionsKey: 'containers' }],
  },
  'discover-containers': {
    label: 'Rediscover Containers on Host',
    params: [{ name: 'hostId', label: 'Host', type: 'select', optionsKey: 'hosts' }],
  },
  // Add more event definitions here
};
// --- End Configuration ---

const conditionSchema = z.object({
  fact: z.string().min(1, "Fact is required"),
  operator: z.string().min(1, "Operator is required"),
  value: z.any(),
  params: z.record(z.any()).optional(),
});

const formSchema = z.object({
  name: z.string().min(1, "Rule name is required"),
  description: z.string().optional(),
  conditions: z.array(conditionSchema).min(1, "At least one condition is required"),
  event: z.object({
    type: z.string().min(1, "Event type is required"),
    params: z.record(z.any()).optional(),
  }),
});

type FormData = z.infer<typeof formSchema>;

interface Props {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  rule: AutomationRule | null;
  onSave: (data: Partial<AutomationRule>) => void;
  isSaving: boolean;
}

export function CreateEditAutomationRuleDialog({ isOpen, onOpenChange, rule, onSave, isSaving }: Props) {
  const { data: hosts = [], isLoading: isLoadingHosts } = useQuery({
    queryKey: ['hosts'],
    queryFn: fetchHosts,
    enabled: isOpen,
  });
  
  const { data: containers = [], isLoading: isLoadingContainers } = useQuery({
    queryKey: ['containers'],
    queryFn: fetchContainers,
    enabled: isOpen,
  });

  const containerOptions: ComboboxOption[] = (!isLoadingContainers && Array.isArray(containers) ? containers : []).map(c => ({
    value: c.id,
    label: c.name,
    group: c.host.name,
  }));

  const hostOptions: ComboboxOption[] = (!isLoadingHosts && Array.isArray(hosts) ? hosts : []).map(h => ({
    value: h.id,
    label: h.name,
  }));

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      description: '',
      conditions: [],
      event: { type: '', params: {} },
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'conditions',
  });

  useEffect(() => {
    if (rule) {
      const ruleJson = rule.ruleJson;
      const conditions = ruleJson.conditions.all.map((c: any) => ({
        fact: c.fact,
        operator: c.operator,
        value: c.value,
        params: c.params,
      }));
      form.reset({
        name: rule.name,
        description: rule.description || '',
        conditions: conditions,
        event: ruleJson.event,
      });
    } else {
      form.reset({
        name: '',
        description: '',
        conditions: [{ fact: '', operator: '', value: '' }],
        event: { type: '', params: {} },
      });
    }
  }, [rule, form]);

  const onSubmit = (data: FormData) => {
    const ruleJson = {
      conditions: {
        all: data.conditions.map(c => {
          const factDef = FACTS_DEFINITIONS[c.fact as keyof typeof FACTS_DEFINITIONS];
          return { ...c, path: factDef?.factPath };
        }),
      },
      event: data.event,
    };
    onSave({
      name: data.name,
      description: data.description,
      ruleJson: ruleJson as any,
    });
  };

  const selectedEventType = form.watch('event.type');
  const eventParams = EVENTS_DEFINITIONS[selectedEventType as keyof typeof EVENTS_DEFINITIONS]?.params;

  const dynamicOptions = {
    hosts: hostOptions,
    containers: containerOptions,
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[60%]">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit Automation Rule' : 'Create New Automation Rule'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <ScrollArea className="h-[60vh] p-4">
              <div className="space-y-4">
                <FormField name="name" control={form.control} render={({ field }) => (
                  <FormItem><FormLabel>Rule Name</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField name="description" control={form.control} render={({ field }) => (
                  <FormItem><FormLabel>Description</FormLabel><FormControl><Input {...field} value={field.value ?? ''} /></FormControl><FormMessage /></FormItem>
                )} />

                <div className="space-y-2">
                  <h3 className="font-semibold">IF (Conditions)</h3>
                  {fields.map((field, index) => {
                    const selectedFactKey = form.watch(`conditions.${index}.fact`);
                    const factDef = FACTS_DEFINITIONS[selectedFactKey as keyof typeof FACTS_DEFINITIONS];
                    return (
                      <div key={field.id} className="flex items-start gap-2 p-2 border rounded-md">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 flex-grow">
                          <FormField name={`conditions.${index}.fact`} control={form.control} render={({ field }) => (
                            <FormItem>
                              <FormLabel>Fact</FormLabel>
                              <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select a fact..." /></SelectTrigger></FormControl>
                                <SelectContent>{Object.entries(FACTS_DEFINITIONS).map(([key, { label }]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
                              </Select>
                              {/* <FormMessage /> */}
                            </FormItem>
                          )} />
                          {factDef?.param && (
                             <FormField name={`conditions.${index}.params.${factDef.param.name}`} control={form.control} render={({ field }) => (
                              <FormItem><FormLabel>{factDef.param.label}</FormLabel>
                                <FormControl>
                                  {factDef.param.type === 'combobox' ? (
                                    <Combobox
                                      options={dynamicOptions[factDef.param.optionsKey as keyof typeof dynamicOptions] || []}
                                      value={field.value}
                                      onChange={field.onChange}
                                      placeholder={`Select a ${factDef.param.label.toLowerCase()}...`}
                                      searchPlaceholder="Search..."
                                      emptyPlaceholder={isLoadingContainers ? "Loading..." : "No options found."}
                                    />
                                  ) : (
                                    <Input {...field} value={field.value ?? ''} />
                                  )}
                                </FormControl>
                              <FormMessage /></FormItem>
                            )} />
                          )}
                          <FormField name={`conditions.${index}.operator`} control={form.control} render={({ field }) => (
                            <FormItem><FormLabel>Operator</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value} disabled={!factDef}><FormControl><SelectTrigger><SelectValue placeholder="Select operator..." /></SelectTrigger></FormControl><SelectContent>{factDef?.operators.map(op => <SelectItem key={op} value={op}>{op}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                          )} />
                          <FormField name={`conditions.${index}.value`} control={form.control} render={({ field }) => (
                            <FormItem><FormLabel>Value</FormLabel>
                              {factDef?.valueType === 'select' ? (
                                <Select onValueChange={field.onChange} defaultValue={field.value} disabled={!factDef}><FormControl><SelectTrigger><SelectValue placeholder="Select value..." /></SelectTrigger></FormControl><SelectContent>{factDef.valueOptions.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}</SelectContent></Select>
                              ) : ( <FormControl><Input {...field} value={field.value ?? ''} disabled={!factDef} /></FormControl> )}
                            <FormMessage /></FormItem>
                          )} />
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="mt-8" onClick={() => remove(index)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                      </div>
                    );
                  })}
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ fact: '', operator: '', value: '' })}><PlusCircle className="mr-2 h-4 w-4" />Add Condition</Button>
                </div>

                <div className="space-y-2">
                  <h3 className="font-semibold">THEN (Event)</h3>
                  <div className="p-2 border rounded-md space-y-2">
                    <FormField name="event.type" control={form.control} render={({ field }) => (
                      <FormItem><FormLabel>Action Type</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select an action..." /></SelectTrigger></FormControl><SelectContent>{Object.entries(EVENTS_DEFINITIONS).map(([key, { label }]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select><FormMessage /></FormItem>
                    )} />
                    {eventParams?.map(param => (
                      <FormField key={param.name} name={`event.params.${param.name}`} control={form.control} render={({ field }) => (
                        <FormItem>
                          <FormLabel>{param.label}</FormLabel>
                          <FormControl>
                            {param.type === 'select' ? (
                              <Select onValueChange={field.onChange} value={field.value ?? ''}>
                                <SelectTrigger><SelectValue placeholder={`Select a ${param.label.toLowerCase()}...`} /></SelectTrigger>
                                <SelectContent>
                                  {isLoadingHosts ? <SelectItem value="loading" disabled>Loading...</SelectItem> :
                                    (dynamicOptions[param.optionsKey as keyof typeof dynamicOptions] || []).map((option: ComboboxOption) => (
                                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                    ))
                                  }
                                </SelectContent>
                              </Select>
                            ) : param.type === 'combobox' ? (
                                <Combobox
                                  options={dynamicOptions[param.optionsKey as keyof typeof dynamicOptions] || []}
                                  value={field.value}
                                  onChange={field.onChange}
                                  placeholder={`Select a ${param.label.toLowerCase()}...`}
                                  searchPlaceholder="Search..."
                                  emptyPlaceholder={isLoadingContainers ? "Loading..." : "No options found."}
                                />
                            ) : (
                              <Input {...field} value={field.value ?? ''} />
                            )}
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    ))}
                  </div>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Rule'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
