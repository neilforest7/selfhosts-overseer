'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

interface DnsProvider {
  id: string;
  name: string;
  displayName: string;
  isEnabled: boolean;
}

interface CreateDnsRecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface CreateDnsRecordData {
  domain: string;
  recordType: string;
  providerId: string;
  isEnabled: boolean;
  checkInterval: number;
  description?: string;
  tags?: string[];
}

async function fetchDnsProviders(): Promise<DnsProvider[]> {
  const response = await fetch('/api/v1/dns/providers');
  if (!response.ok) {
    throw new Error('Failed to fetch DNS providers');
  }
  return response.json();
}

async function createDnsRecord(data: CreateDnsRecordData): Promise<void> {
  const response = await fetch('/api/v1/dns/records', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create DNS record');
  }
}

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];

export function CreateDnsRecordDialog({ open, onOpenChange, onSuccess }: CreateDnsRecordDialogProps) {
  const [formData, setFormData] = useState<CreateDnsRecordData>({
    domain: '',
    recordType: 'A',
    providerId: '',
    isEnabled: true,
    checkInterval: 300,
    description: '',
    tags: [],
  });

  const { data: providers, isLoading: providersLoading } = useQuery({
    queryKey: ['dns-providers'],
    queryFn: fetchDnsProviders,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: createDnsRecord,
    onSuccess: () => {
      toast.success('DNS record created successfully');
      onSuccess();
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to create DNS record: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFormData({
      domain: '',
      recordType: 'A',
      providerId: '',
      isEnabled: true,
      checkInterval: 300,
      description: '',
      tags: [],
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.domain || !formData.providerId) {
      toast.error('Please fill in all required fields');
      return;
    }
    createMutation.mutate(formData);
  };

  const handleTagsChange = (value: string) => {
    const tags = value.split(',').map(tag => tag.trim()).filter(Boolean);
    setFormData(prev => ({ ...prev, tags }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create DNS Record</DialogTitle>
          <DialogDescription>
            Add a new DNS record to monitor its resolution status.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain *</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={formData.domain}
              onChange={(e) => setFormData(prev => ({ ...prev, domain: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recordType">Record Type</Label>
            <Select
              value={formData.recordType}
              onValueChange={(value) => setFormData(prev => ({ ...prev, recordType: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECORD_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider">DNS Provider *</Label>
            <Select
              value={formData.providerId}
              onValueChange={(value) => setFormData(prev => ({ ...prev, providerId: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {providersLoading ? (
                  <SelectItem value="loading" disabled>Loading providers...</SelectItem>
                ) : providers?.filter(p => p.isEnabled).length === 0 ? (
                  <SelectItem value="no-providers" disabled>No providers available</SelectItem>
                ) : (
                  providers?.filter(p => p.isEnabled).map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.displayName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="checkInterval">Check Interval (seconds)</Label>
            <Input
              id="checkInterval"
              type="number"
              min="60"
              value={formData.checkInterval}
              onChange={(e) => setFormData(prev => ({ ...prev, checkInterval: parseInt(e.target.value) || 300 }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Optional description for this DNS record"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              placeholder="production, api, frontend"
              value={formData.tags?.join(', ') || ''}
              onChange={(e) => handleTagsChange(e.target.value)}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="enabled"
              checked={formData.isEnabled}
              onCheckedChange={(checked) => setFormData(prev => ({ ...prev, isEnabled: checked }))}
            />
            <Label htmlFor="enabled">Enable monitoring</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Record'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
