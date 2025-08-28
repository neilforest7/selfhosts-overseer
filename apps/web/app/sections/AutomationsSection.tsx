"use client";

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, MoreHorizontal, Trash2, Pencil, PlayCircle, AlertCircle } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { CreateEditAutomationRuleDialog } from './CreateEditAutomationRuleDialog';

// Matches the Prisma model and the backend response
export type AutomationRule = {
  id: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  ruleJson: any;
  createdAt: string;
  updatedAt: string;
  _count: {
    operations: number;
  };
  errorCount: number;
};

async function fetchAutomationRules(): Promise<AutomationRule[]> {
  const r = await fetch('/api/v1/automations');
  if (!r.ok) throw new Error('Failed to fetch automation rules');
  const data = await r.json();
  return data.items || data;
}

export default function AutomationsSection() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<AutomationRule | null>(null);

  const { data: rules = [], isLoading } = useQuery<AutomationRule[]>({
    queryKey: ['automationRules'],
    queryFn: fetchAutomationRules,
  });

  const mutationOptions = {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
      toast.success('Automation rule saved successfully');
      setIsDialogOpen(false);
      setSelectedRule(null);
    },
    onError: (error: Error) => {
      toast.error('Failed to save rule', { description: error.message });
    },
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<AutomationRule>) => fetch('/api/v1/automations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    ...mutationOptions,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<AutomationRule> }) => fetch(`/api/v1/automations/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
    ...mutationOptions,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/v1/automations/${id}`, { method: 'DELETE' }),
     onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automationRules'] });
      toast.success('Automation rule deleted');
    },
    onError: (error: Error) => {
      toast.error('Failed to delete rule', { description: error.message });
    },
  });

  const handleSave = (data: Partial<AutomationRule>) => {
    if (selectedRule) {
      updateMutation.mutate({ id: selectedRule.id, data });
    } else {
      createMutation.mutate(data);
    }
  };
  
  const handleToggle = (rule: AutomationRule) => {
    updateMutation.mutate({ id: rule.id, data: { isEnabled: !rule.isEnabled } });
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Automation Rules</CardTitle>
          <Button onClick={() => { setSelectedRule(null); setIsDialogOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            New Rule
          </Button>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Enabled</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Stats</TableHead>
                  <TableHead>Last Modified</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? ( <TableRow><TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell></TableRow> ) 
                : rules.length === 0 ? ( <TableRow><TableCell colSpan={5} className="h-24 text-center">No automation rules found.</TableCell></TableRow> ) 
                : (
                  rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <Switch
                          checked={rule.isEnabled}
                          onCheckedChange={() => handleToggle(rule)}
                          aria-label="Toggle rule"
                        />
                      </TableCell>
                      <TableCell className="font-medium">{rule.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center text-sm text-muted-foreground" title="Trigger count">
                            <PlayCircle className="mr-1 h-4 w-4" />
                            {rule._count.operations}
                          </div>
                          <div className={`flex items-center text-sm ${rule.errorCount > 0 ? 'text-destructive' : 'text-muted-foreground'}`} title="Error count">
                            <AlertCircle className="mr-1 h-4 w-4" />
                            {rule.errorCount}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{new Date(rule.updatedAt).toLocaleString()}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" className="h-8 w-8 p-0"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setSelectedRule(rule); setIsDialogOpen(true); }}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => deleteMutation.mutate(rule.id)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
      <CreateEditAutomationRuleDialog
        isOpen={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        rule={selectedRule}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
    </>
  );
}