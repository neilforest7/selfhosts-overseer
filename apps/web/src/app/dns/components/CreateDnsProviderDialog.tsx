'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';

interface AvailableProvider {
  name: string;
  displayName: string;
}

interface DnsProvider {
  id: string;
  name: string;
  displayName: string;
  apiConfig: Record<string, string>;
  isEnabled: boolean;
}

interface CreateDnsProviderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  provider?: DnsProvider; // Optional: if provided, dialog is in edit mode
}

interface CreateDnsProviderData {
  name: string;
  displayName: string;
  apiConfig: Record<string, string>;
  isEnabled: boolean;
}

async function fetchAvailableProviders(): Promise<AvailableProvider[]> {
  const response = await fetch('/api/v1/dns/providers/available');
  if (!response.ok) throw new Error('Failed to fetch available providers');
  return response.json();
}

async function createDnsProvider(data: CreateDnsProviderData): Promise<any> {
  const response = await fetch('/api/v1/dns/providers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create provider');
  }
  return response.json();
}

async function updateDnsProvider(id: string, data: Partial<CreateDnsProviderData>): Promise<void> {
  const response = await fetch(`/api/v1/dns/providers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update provider');
  }
}

async function discoverDnsRecords(providerId: string, options: {
  importRecords: boolean;
  recordTypes?: string[];
  skipExisting?: boolean;
  updateExisting?: boolean;
}): Promise<any> {
  const response = await fetch(`/api/v1/dns/providers/${providerId}/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to discover DNS records');
  }
  return response.json();
}

export function CreateDnsProviderDialog({ open, onOpenChange, onSuccess, provider }: CreateDnsProviderDialogProps) {
  const queryClient = useQueryClient();
  const isEditMode = !!provider;
  const [providerType, setProviderType] = useState(provider?.name || '');
  const [providerConfig, setProviderConfig] = useState<Record<string, string>>(provider?.apiConfig || {});

  // Discovery state
  const [autoDiscoverRecords, setAutoDiscoverRecords] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] = useState(0);
  const [discoveryStatus, setDiscoveryStatus] = useState('');

  const { data: availableProviders } = useQuery({
    queryKey: ['available-dns-providers'],
    queryFn: fetchAvailableProviders,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: createDnsProvider,
    onSuccess: () => {
      toast.success('DNS provider created successfully');
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] });
      onSuccess();
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to create provider: ${error.message}`);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateDnsProviderData> }) =>
      updateDnsProvider(id, data),
    onSuccess: () => {
      toast.success('DNS provider updated successfully');
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] });
      onSuccess();
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to update provider: ${error.message}`);
    },
  });

  const discoveryMutation = useMutation({
    mutationFn: ({ providerId, options }: { providerId: string; options: any }) =>
      discoverDnsRecords(providerId, options),
    onSuccess: (result) => {
      setIsDiscovering(false);
      setDiscoveryProgress(100);
      setDiscoveryStatus('Discovery completed');

      const message = `Discovery completed: ${result.zonesDiscovered} zones, ${result.recordsDiscovered} records found`;
      if (result.recordsImported > 0) {
        toast.success(`${message}. Imported ${result.recordsImported} records.`);
      } else {
        toast.success(message);
      }

      queryClient.invalidateQueries({ queryKey: ['dns-records'] });
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] });
    },
    onError: (error) => {
      setIsDiscovering(false);
      setDiscoveryStatus('Discovery failed');
      toast.error(`DNS discovery failed: ${error.message}`);
    },
  });

  const resetForm = () => {
    setProviderType(provider?.name || '');
    setProviderConfig(provider?.apiConfig || {});
    setAutoDiscoverRecords(false);
    setIsDiscovering(false);
    setDiscoveryProgress(0);
    setDiscoveryStatus('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerType) {
      toast.error('Please select a provider type');
      return;
    }

    const providerData = {
      name: providerType,
      displayName: availableProviders?.find(p => p.name === providerType)?.displayName || providerType,
      apiConfig: providerConfig,
      isEnabled: provider?.isEnabled ?? true,
    };

    if (isEditMode && provider) {
      updateMutation.mutate({ id: provider.id, data: providerData });
    } else {
      // For new providers, we need to handle discovery after creation
      try {
        const newProvider = await createMutation.mutateAsync(providerData);

        // If auto-discovery is enabled and this is a Cloudflare provider
        if (autoDiscoverRecords && providerType === 'cloudflare' && newProvider?.id) {
          setIsDiscovering(true);
          setDiscoveryProgress(10);
          setDiscoveryStatus('Starting DNS record discovery...');

          discoveryMutation.mutate({
            providerId: newProvider.id,
            options: {
              importRecords: true,
              skipExisting: true,
              updateExisting: false,
            },
          });
        }
      } catch (error) {
        // Error is already handled by the mutation
      }
    }
  };

  const renderProviderConfig = () => {
    if (providerType === 'cloudflare') {
      return (
        <div className="space-y-3">
          <div>
            <Label htmlFor="cf-email">Email</Label>
            <Input
              id="cf-email"
              type="email"
              placeholder="your-email@example.com"
              value={providerConfig.email || ''}
              onChange={(e) => setProviderConfig(prev => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="cf-api-key">Global API Key</Label>
            <Input
              id="cf-api-key"
              type="password"
              placeholder="Your Cloudflare Global API Key (not API Token)"
              value={providerConfig.apiKey || ''}
              onChange={(e) => setProviderConfig(prev => ({ ...prev, apiKey: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use your Global API Key from Cloudflare dashboard, not an API Token.
              Find it at: My Profile → API Tokens → Global API Key
            </p>
          </div>
        </div>
      );
    }

    if (providerType === 'dns-over-https') {
      return (
        <div>
          <Label htmlFor="doh-endpoint">DNS over HTTPS Endpoint</Label>
          <Input
            id="doh-endpoint"
            type="url"
            placeholder="https://cloudflare-dns.com/dns-query"
            value={providerConfig.endpoint || ''}
            onChange={(e) => setProviderConfig(prev => ({ ...prev, endpoint: e.target.value }))}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit DNS Provider' : 'Add DNS Provider'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the configuration for this DNS service provider.'
              : 'Configure a new DNS service provider for domain resolution.'
            }
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider-type">Provider Type</Label>
            <Select value={providerType} onValueChange={setProviderType} disabled={isEditMode}>
              <SelectTrigger>
                <SelectValue placeholder="Select a provider type" />
              </SelectTrigger>
              <SelectContent>
                {availableProviders?.map((provider) => (
                  <SelectItem key={provider.name} value={provider.name}>
                    {provider.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {renderProviderConfig()}

          {/* Auto-discovery option for Cloudflare providers */}
          {!isEditMode && providerType === 'cloudflare' && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="auto-discover"
                  checked={autoDiscoverRecords}
                  onCheckedChange={(checked) => setAutoDiscoverRecords(checked as boolean)}
                />
                <Label htmlFor="auto-discover" className="text-sm font-medium">
                  Automatically discover and import existing DNS records
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                This will scan your Cloudflare account for all domains and DNS records, then import them for monitoring.
              </p>
            </div>
          )}

          {/* Discovery progress */}
          {isDiscovering && (
            <div className="space-y-2 border-t pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Discovering DNS Records</Label>
                <span className="text-xs text-muted-foreground">{discoveryProgress}%</span>
              </div>
              <Progress value={discoveryProgress} className="w-full" />
              <p className="text-xs text-muted-foreground">{discoveryStatus}</p>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={(isEditMode ? updateMutation.isPending : createMutation.isPending) || !providerType || isDiscovering}
            >
              {isEditMode
                ? (updateMutation.isPending ? 'Updating...' : 'Update Provider')
                : isDiscovering
                ? 'Discovering Records...'
                : (createMutation.isPending ? 'Creating...' : 'Create Provider')
              }
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
