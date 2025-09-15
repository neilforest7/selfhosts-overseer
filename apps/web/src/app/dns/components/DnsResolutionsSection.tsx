'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DnsStatusBadge } from './DnsStatusBadge';

interface DnsResolution {
  id: string;
  resolvedIp?: string;
  responseTime?: number;
  status: string;
  errorMessage?: string;
  checkedAt: string;
  dnsRecord: {
    id: string;
    domain: string;
    recordType: string;
    provider: {
      displayName: string;
    };
  };
}

async function fetchDnsResolutions(hours: number): Promise<DnsResolution[]> {
  const response = await fetch(`/api/v1/dns/resolutions?hours=${hours}`);
  if (!response.ok) {
    throw new Error('Failed to fetch DNS resolutions');
  }
  return response.json();
}

export function DnsResolutionsSection() {
  const [timeRange, setTimeRange] = useState('24');

  const { data: resolutions, isLoading, error } = useQuery({
    queryKey: ['dns-resolutions', timeRange],
    queryFn: () => fetchDnsResolutions(parseInt(timeRange)),
    refetchInterval: 30000,
  });

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-destructive">Failed to load DNS resolution history</p>
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
              <CardTitle>Resolution History</CardTitle>
              <CardDescription>
                View recent DNS resolution attempts and their results
              </CardDescription>
            </div>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 1 hour</SelectItem>
                <SelectItem value="6">Last 6 hours</SelectItem>
                <SelectItem value="24">Last 24 hours</SelectItem>
                <SelectItem value="72">Last 3 days</SelectItem>
                <SelectItem value="168">Last week</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {resolutions?.map((resolution) => (
                <div
                  key={resolution.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium">{resolution.dnsRecord.domain}</h3>
                      <Badge variant="outline">{resolution.dnsRecord.recordType}</Badge>
                      <DnsStatusBadge status={resolution.status} />
                    </div>
                    <div className="text-sm text-muted-foreground">
                      <span>Provider: {resolution.dnsRecord.provider.displayName}</span>
                      {resolution.resolvedIp && (
                        <span className="ml-4">IP: {resolution.resolvedIp}</span>
                      )}
                      {resolution.responseTime && (
                        <span className="ml-4">
                          Response: {resolution.responseTime}ms
                        </span>
                      )}
                      <span className="ml-4">
                        {new Date(resolution.checkedAt).toLocaleString()}
                      </span>
                    </div>
                    {resolution.errorMessage && (
                      <div className="text-sm text-destructive mt-1">
                        Error: {resolution.errorMessage}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {resolutions?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No DNS resolutions found for the selected time range
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
