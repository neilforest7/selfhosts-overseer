'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Search, RefreshCw, Play, Trash2, Filter } from 'lucide-react';
import { DnsStatusBadge } from './DnsStatusBadge';
import { CreateDnsRecordDialog } from './CreateDnsRecordDialog';
import { toast } from 'sonner';

// DNS Record Types from backend enum
const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'PTR', 'SRV', 'CAA'] as const;
type DnsRecordType = typeof DNS_RECORD_TYPES[number];

// DNS Status Types from backend enum
const DNS_STATUS_TYPES = ['UNKNOWN', 'RESOLVED', 'FAILED', 'TIMEOUT', 'NO_RECORD'] as const;
type DnsStatus = typeof DNS_STATUS_TYPES[number];

// Filter types
type RootDomainFilter = string | 'all';
type RecordTypeFilter = DnsRecordType | 'all';
type ResolutionStatusFilter = 'all' | 'resolved' | 'unresolved';

interface DnsRecord {
  id: string;
  domain: string;
  recordType: string;
  currentIp?: string;
  status: string;
  lastCheckAt?: string;
  lastChangeAt?: string;
  isEnabled: boolean;
  checkInterval: number;
  provider: {
    id: string;
    displayName: string;
  };
}

async function fetchDnsRecords(): Promise<DnsRecord[]> {
  const response = await fetch('/api/v1/dns/records');
  if (!response.ok) {
    throw new Error('Failed to fetch DNS records');
  }
  return response.json();
}

async function triggerResolution(recordId: string): Promise<void> {
  const response = await fetch(`/api/v1/dns/records/${recordId}/resolve`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error('Failed to trigger DNS resolution');
  }
}

async function deleteRecord(recordId: string): Promise<void> {
  const response = await fetch(`/api/v1/dns/records/${recordId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete DNS record');
  }
}

// Helper function to extract root domain from a full domain
function extractRootDomain(domain: string): string {
  const parts = domain.split('.');
  if (parts.length <= 2) {
    return domain;
  }
  // Return the last two parts (e.g., "example.com" from "api.subdomain.example.com")
  return parts.slice(-2).join('.');
}

// Helper function to determine if a record is resolved
function isRecordResolved(record: DnsRecord): boolean {
  return record.status === 'RESOLVED' && record.currentIp != null;
}

export function DnsRecordsSection() {
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [rootDomainFilter, setRootDomainFilter] = useState<RootDomainFilter>('all');
  const [recordTypeFilter, setRecordTypeFilter] = useState<RecordTypeFilter>('all');
  const [resolutionStatusFilter, setResolutionStatusFilter] = useState<ResolutionStatusFilter>('all');
  const queryClient = useQueryClient();

  const { data: records, isLoading, error } = useQuery({
    queryKey: ['dns-records'],
    queryFn: fetchDnsRecords,
    refetchInterval: 30000,
  });

  const resolveMutation = useMutation({
    mutationFn: triggerResolution,
    onSuccess: () => {
      toast.success('DNS resolution triggered');
      queryClient.invalidateQueries({ queryKey: ['dns-records'] });
    },
    onError: (error) => {
      toast.error(`Failed to trigger resolution: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteRecord,
    onSuccess: () => {
      toast.success('DNS record deleted');
      queryClient.invalidateQueries({ queryKey: ['dns-records'] });
    },
    onError: (error) => {
      toast.error(`Failed to delete record: ${error.message}`);
    },
  });

  // Compute unique root domains for the filter dropdown
  const uniqueRootDomains = useMemo(() => {
    if (!records) return [];
    const domains = new Set(records.map(record => extractRootDomain(record.domain)));
    return Array.from(domains).sort();
  }, [records]);

  // Apply all filters to the records
  const filteredRecords = useMemo(() => {
    if (!records) return [];

    return records.filter(record => {
      // Search filter
      const matchesSearch = searchTerm === '' ||
        record.domain.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.provider.displayName.toLowerCase().includes(searchTerm.toLowerCase());

      // Root domain filter
      const matchesRootDomain = rootDomainFilter === 'all' ||
        extractRootDomain(record.domain) === rootDomainFilter;

      // Record type filter
      const matchesRecordType = recordTypeFilter === 'all' ||
        record.recordType === recordTypeFilter;

      // Resolution status filter
      const matchesResolutionStatus = resolutionStatusFilter === 'all' ||
        (resolutionStatusFilter === 'resolved' && isRecordResolved(record)) ||
        (resolutionStatusFilter === 'unresolved' && !isRecordResolved(record));

      return matchesSearch && matchesRootDomain && matchesRecordType && matchesResolutionStatus;
    });
  }, [records, searchTerm, rootDomainFilter, recordTypeFilter, resolutionStatusFilter]);

  // Count active filters for visual indicator
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (rootDomainFilter !== 'all') count++;
    if (recordTypeFilter !== 'all') count++;
    if (resolutionStatusFilter !== 'all') count++;
    return count;
  }, [rootDomainFilter, recordTypeFilter, resolutionStatusFilter]);

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">Failed to load DNS records</p>
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
              <CardTitle>DNS Records</CardTitle>
              <CardDescription>
                Manage DNS records and monitor their resolution status
              </CardDescription>
            </div>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Record
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 mb-4">
            {/* Search and Filters Row */}
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search records..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>

              {/* Root Domain Filter */}
              <Select value={rootDomainFilter} onValueChange={(value) => setRootDomainFilter(value as RootDomainFilter)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All Domains" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Domains</SelectItem>
                  {uniqueRootDomains.map((domain) => (
                    <SelectItem key={domain} value={domain}>
                      {domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Record Type Filter */}
              <Select value={recordTypeFilter} onValueChange={(value) => setRecordTypeFilter(value as RecordTypeFilter)}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {DNS_RECORD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Resolution Status Filter */}
              <Select value={resolutionStatusFilter} onValueChange={(value) => setResolutionStatusFilter(value as ResolutionStatusFilter)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All Records" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Records</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="unresolved">Unresolved</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Active Filters Indicator */}
            {activeFiltersCount > 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Filter className="h-4 w-4" />
                <span>{activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} active</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setRootDomainFilter('all');
                    setRecordTypeFilter('all');
                    setResolutionStatusFilter('all');
                  }}
                  className="h-6 px-2 text-xs"
                >
                  Clear all
                </Button>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRecords.map((record) => (
                <div
                  key={record.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">{record.domain}</h3>
                      <Badge variant="outline">{record.recordType}</Badge>
                      <DnsStatusBadge status={record.status} />
                      {!record.isEnabled && (
                        <Badge variant="secondary">Disabled</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span>Provider: {record.provider.displayName}</span>
                      {record.currentIp && (
                        <span className="ml-4">IP: {record.currentIp}</span>
                      )}
                      {record.lastCheckAt && (
                        <span className="ml-4">
                          Last checked: {new Date(record.lastCheckAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resolveMutation.mutate(record.id)}
                      disabled={resolveMutation.isPending}
                    >
                      {resolveMutation.isPending ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteMutation.mutate(record.id)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {filteredRecords.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  {searchTerm || activeFiltersCount > 0
                    ? 'No records match your search and filters'
                    : 'No DNS records found'}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateDnsRecordDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['dns-records'] });
          setShowCreateDialog(false);
        }}
      />
    </div>
  );
}
