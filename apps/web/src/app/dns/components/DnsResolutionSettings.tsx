'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Clock, Filter, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface DnsSettings {
  dnsResolutionFrequencyMinutes: number;
  dnsSkipNonAddressRecords: boolean;
}

interface Settings extends DnsSettings {
  [key: string]: any;
}

// Frequency options for DNS resolution
const FREQUENCY_OPTIONS = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

async function fetchSettings(): Promise<Settings> {
  const response = await fetch('/api/v1/settings');
  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }
  return response.json();
}

async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  const response = await fetch('/api/v1/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update settings');
  }
  return response.json();
}

export function DnsResolutionSettings() {
  const queryClient = useQueryClient();
  const [localSettings, setLocalSettings] = useState<Partial<DnsSettings>>({});
  const [hasChanges, setHasChanges] = useState(false);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  // Initialize local settings when data loads
  useEffect(() => {
    if (settings) {
      setLocalSettings({
        dnsResolutionFrequencyMinutes: settings.dnsResolutionFrequencyMinutes,
        dnsSkipNonAddressRecords: settings.dnsSkipNonAddressRecords,
      });
      setHasChanges(false);
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      toast.success('DNS resolution settings updated successfully');
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setHasChanges(false);
    },
    onError: (error) => {
      toast.error(`Failed to update settings: ${error.message}`);
    },
  });

  const handleFrequencyChange = (value: string) => {
    const frequencyMinutes = parseInt(value, 10);
    setLocalSettings(prev => ({ ...prev, dnsResolutionFrequencyMinutes: frequencyMinutes }));
    setHasChanges(true);
  };

  const handleFilterChange = (checked: boolean) => {
    setLocalSettings(prev => ({ ...prev, dnsSkipNonAddressRecords: checked }));
    setHasChanges(true);
  };

  const handleSave = () => {
    updateMutation.mutate(localSettings);
  };

  const handleReset = () => {
    if (settings) {
      setLocalSettings({
        dnsResolutionFrequencyMinutes: settings.dnsResolutionFrequencyMinutes,
        dnsSkipNonAddressRecords: settings.dnsSkipNonAddressRecords,
      });
      setHasChanges(false);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            DNS Resolution Settings
          </CardTitle>
          <CardDescription>
            Configure DNS resolution frequency and filtering options
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/4"></div>
            <div className="h-10 bg-muted rounded"></div>
            <div className="h-4 bg-muted rounded w-1/3"></div>
            <div className="h-6 bg-muted rounded w-1/2"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const currentFrequency = localSettings.dnsResolutionFrequencyMinutes ?? settings?.dnsResolutionFrequencyMinutes ?? 60;
  const currentFilter = localSettings.dnsSkipNonAddressRecords ?? settings?.dnsSkipNonAddressRecords ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          DNS Resolution Settings
        </CardTitle>
        <CardDescription>
          Configure how often DNS records are resolved and which record types to process
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Resolution Frequency */}
        <div className="space-y-3">
          <Label htmlFor="frequency" className="text-sm font-medium">
            Resolution Frequency
          </Label>
          <Select
            value={currentFrequency.toString()}
            onValueChange={handleFrequencyChange}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select frequency" />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value.toString()}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            How often the system should check and resolve DNS records. Lower frequencies provide more real-time monitoring but consume more resources.
          </p>
        </div>

        <Separator />

        {/* Record Type Filtering */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4" />
            <Label className="text-sm font-medium">Record Type Filtering</Label>
          </div>
          
          <div className="flex items-center space-x-2">
            <Checkbox
              id="skip-non-standard"
              checked={currentFilter}
              onCheckedChange={handleFilterChange}
            />
            <Label htmlFor="skip-non-standard" className="text-sm">
              Skip non-standard DNS record types during resolution
            </Label>
          </div>

          <p className="text-xs text-muted-foreground">
            When enabled, only standard DNS record types (A, AAAA, and CNAME) will be resolved, skipping specialized types like MX, TXT, NS, PTR, SRV, and CAA. This improves performance by focusing on the most commonly used record types.
          </p>
        </div>

        {/* Action Buttons */}
        {hasChanges && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                You have unsaved changes
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-2"
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset
                </Button>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  className="flex items-center gap-2"
                >
                  <Save className="h-4 w-4" />
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
