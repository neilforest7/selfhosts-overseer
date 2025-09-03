"use client";

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Globe, TestTube, Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';

interface DnsProvider {
  id: string;
  name: string;
  displayName: string;
  isEnabled: boolean;
  rateLimitPerMinute: number;
  timeoutSeconds: number;
}

interface AvailableProvider {
  name: string;
  displayName: string;
}

async function fetchDnsProviders(): Promise<DnsProvider[]> {
  const response = await fetch('/api/v1/dns/providers');
  if (!response.ok) throw new Error('Failed to fetch DNS providers');
  return response.json();
}

async function fetchAvailableProviders(): Promise<AvailableProvider[]> {
  const response = await fetch('/api/v1/dns/providers/available');
  if (!response.ok) throw new Error('Failed to fetch available providers');
  return response.json();
}

async function testProvider(providerId: string): Promise<{ connected: boolean }> {
  const response = await fetch(`/api/v1/dns/providers/${providerId}/test`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to test provider');
  return response.json();
}

async function deleteProvider(providerId: string): Promise<void> {
  const response = await fetch(`/api/v1/dns/providers/${providerId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete provider');
}

export function DnsSettingsSection() {
  const queryClient = useQueryClient();
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProviderType, setNewProviderType] = useState('');
  const [newProviderConfig, setNewProviderConfig] = useState<Record<string, string>>({});

  const { data: providers, isLoading } = useQuery({
    queryKey: ['dns-providers'],
    queryFn: fetchDnsProviders,
  });

  const { data: availableProviders } = useQuery({
    queryKey: ['available-dns-providers'],
    queryFn: fetchAvailableProviders,
  });

  const testMutation = useMutation({
    mutationFn: testProvider,
    onSuccess: (data) => {
      if (data.connected) {
        toast.success('Provider connection test successful');
      } else {
        toast.error('Provider connection test failed');
      }
    },
    onError: (error) => {
      toast.error(`Connection test failed: ${error.message}`);
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

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/v1/dns/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to create provider');
      return response.json();
    },
    onSuccess: () => {
      toast.success('DNS provider created successfully');
      queryClient.invalidateQueries({ queryKey: ['dns-providers'] });
      setShowAddProvider(false);
      setNewProviderType('');
      setNewProviderConfig({});
    },
    onError: (error) => {
      toast.error(`Failed to create provider: ${error.message}`);
    },
  });

  const handleCreateProvider = () => {
    if (!newProviderType) {
      toast.error('Please select a provider type');
      return;
    }

    const providerData = {
      name: newProviderType,
      displayName: availableProviders?.find(p => p.name === newProviderType)?.displayName || newProviderType,
      apiConfig: newProviderConfig,
      isEnabled: true,
    };

    createMutation.mutate(providerData);
  };

  const renderProviderConfig = () => {
    if (newProviderType === 'cloudflare') {
      return (
        <div className="space-y-3">
          <div>
            <Label htmlFor="cf-email">Email</Label>
            <Input
              id="cf-email"
              type="email"
              placeholder="your-email@example.com"
              value={newProviderConfig.email || ''}
              onChange={(e) => setNewProviderConfig(prev => ({ ...prev, email: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="cf-api-key">API Key</Label>
            <Input
              id="cf-api-key"
              type="password"
              placeholder="Your Cloudflare API key"
              value={newProviderConfig.apiKey || ''}
              onChange={(e) => setNewProviderConfig(prev => ({ ...prev, apiKey: e.target.value }))}
            />
          </div>
        </div>
      );
    }

    if (newProviderType === 'dns-over-https') {
      return (
        <div>
          <Label htmlFor="doh-endpoint">DNS over HTTPS Endpoint</Label>
          <Input
            id="doh-endpoint"
            type="url"
            placeholder="https://cloudflare-dns.com/dns-query"
            value={newProviderConfig.endpoint || ''}
            onChange={(e) => setNewProviderConfig(prev => ({ ...prev, endpoint: e.target.value }))}
          />
        </div>
      );
    }

    return null;
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            DNS Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-4 bg-muted rounded w-1/2" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          DNS Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing Providers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">DNS Providers</h4>
            <Button
              size="sm"
              onClick={() => setShowAddProvider(true)}
              disabled={showAddProvider}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Provider
            </Button>
          </div>

          {providers?.map((provider) => (
            <div key={provider.id} className="flex items-center justify-between p-3 border rounded-lg">
              <div className="flex items-center gap-3">
                <div>
                  <div className="font-medium">{provider.displayName}</div>
                  <div className="text-sm text-muted-foreground">
                    {provider.name} • {provider.rateLimitPerMinute}/min
                  </div>
                </div>
                <Badge variant={provider.isEnabled ? 'default' : 'secondary'}>
                  {provider.isEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => testMutation.mutate(provider.id)}
                  disabled={testMutation.isPending}
                >
                  <TestTube className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => deleteMutation.mutate(provider.id)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          {providers?.length === 0 && (
            <div className="text-center py-6 text-muted-foreground">
              No DNS providers configured
            </div>
          )}
        </div>

        {/* Add Provider Form */}
        {showAddProvider && (
          <>
            <Separator />
            <div className="space-y-4 p-4 border rounded-lg bg-muted/50">
              <h4 className="font-medium">Add DNS Provider</h4>
              
              <div>
                <Label htmlFor="provider-type">Provider Type</Label>
                <Select value={newProviderType} onValueChange={setNewProviderType}>
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

              <div className="flex gap-2">
                <Button
                  onClick={handleCreateProvider}
                  disabled={createMutation.isPending || !newProviderType}
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Provider'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddProvider(false);
                    setNewProviderType('');
                    setNewProviderConfig({});
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
