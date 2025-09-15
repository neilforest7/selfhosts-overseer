'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Settings, TestTube, Trash2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { CreateDnsProviderDialog } from './CreateDnsProviderDialog';

interface DnsProvider {
  id: string;
  name: string;
  displayName: string;
  isEnabled: boolean;
  rateLimitPerMinute: number;
  timeoutSeconds: number;
  createdAt: string;
  updatedAt: string;
}

async function fetchDnsProviders(): Promise<DnsProvider[]> {
  const response = await fetch('/api/v1/dns/providers');
  if (!response.ok) {
    throw new Error('Failed to fetch DNS providers');
  }
  return response.json();
}

async function testProvider(providerId: string): Promise<{ connected: boolean }> {
  const response = await fetch(`/api/v1/dns/providers/${providerId}/test`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to test provider connection');
  }
  return response.json();
}

async function deleteProvider(providerId: string): Promise<void> {
  const response = await fetch(`/api/v1/dns/providers/${providerId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete DNS provider');
  }
}

async function discoverRecords(providerId: string): Promise<any> {
  const response = await fetch(`/api/v1/dns/providers/${providerId}/discover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      importRecords: true,
      skipExisting: true,
      updateExisting: false,
    }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to discover DNS records');
  }
  return response.json();
}

export function DnsProvidersSection() {
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [discoveringProvider, setDiscoveringProvider] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data: providers, isLoading, error } = useQuery({
    queryKey: ['dns-providers'],
    queryFn: fetchDnsProviders,
    refetchInterval: 30000,
  });

  const testMutation = useMutation({
    mutationFn: testProvider,
    onSuccess: (data, providerId) => {
      if (data.connected) {
        toast.success('Provider connection test successful');
      } else {
        toast.error('Provider connection test failed');
      }
      setTestingProvider(null);
    },
    onError: (error) => {
      toast.error(`Connection test failed: ${error.message}`);
      setTestingProvider(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: () => {
      toast.success('DNS provider deleted');
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] });
    },
    onError: (error) => {
      toast.error(`Failed to delete provider: ${error.message}`);
    },
  });

  const discoveryMutation = useMutation({
    mutationFn: discoverRecords,
    onMutate: (providerId) => {
      setDiscoveringProvider(providerId);
    },
    onSuccess: (result, providerId) => {
      setDiscoveringProvider(null);
      const message = `Discovery completed: ${result.zonesDiscovered} zones, ${result.recordsDiscovered} records found`;
      if (result.recordsImported > 0) {
        toast.success(`${message}. Imported ${result.recordsImported} records.`);
      } else {
        toast.success(message);
      }
      queryClient.invalidateQueries({ queryKey: ['dns-records'] });
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] });
    },
    onError: (error, providerId) => {
      setDiscoveringProvider(null);
      toast.error(`DNS discovery failed: ${error.message}`);
    },
  });

  const handleTestConnection = (providerId: string) => {
    setTestingProvider(providerId);
    testMutation.mutate(providerId);
  };

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">Failed to load DNS providers</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>DNS Providers</CardTitle>
              <CardDescription>
                Manage DNS service providers for domain resolution
              </CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Provider
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-20 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {providers?.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-medium">{provider.displayName}</h3>
                      <Badge variant={provider.isEnabled ? 'default' : 'secondary'}>
                        {provider.isEnabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span>Type: {provider.name}</span>
                      <span className="ml-4">
                        Rate limit: {provider.rateLimitPerMinute}/min
                      </span>
                      <span className="ml-4">
                        Timeout: {provider.timeoutSeconds}s
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection(provider.id)}
                      disabled={testingProvider === provider.id}
                    >
                      <TestTube className="h-4 w-4" />
                      {testingProvider === provider.id ? 'Testing...' : 'Test'}
                    </Button>
                    {provider.name === 'cloudflare' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => discoveryMutation.mutate(provider.id)}
                        disabled={discoveringProvider === provider.id}
                        title="Discover and import DNS records from Cloudflare"
                      >
                        <RefreshCw className={`h-4 w-4 ${discoveringProvider === provider.id ? 'animate-spin' : ''}`} />
                        {discoveringProvider === provider.id ? 'Syncing...' : 'Sync'}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingProvider(provider)}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate(provider.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {providers?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No DNS providers configured
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateDnsProviderDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={() => setShowCreateDialog(false)}
      />

      <CreateDnsProviderDialog
        open={!!editingProvider}
        onOpenChange={(open) => !open && setEditingProvider(null)}
        onSuccess={() => setEditingProvider(null)}
        provider={editingProvider}
      />
    </div>
  );
}
