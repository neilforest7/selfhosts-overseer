'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Activity, Globe, Server } from 'lucide-react';
import { DnsRecordsSection } from './components/DnsRecordsSection';
import { DnsProvidersSection } from './components/DnsProvidersSection';
import { DnsStatsSection } from './components/DnsStatsSection';
import { DnsResolutionsSection } from './components/DnsResolutionsSection';
import { DnsResolutionSettings } from './components/DnsResolutionSettings';

export default function DnsPage() {
  const [activeTab, setActiveTab] = useState('records');

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DNS Management</h1>
          <p className="text-muted-foreground">
            Monitor and manage DNS resolution for your domains
          </p>
        </div>
      </div>

      <DnsStatsSection />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="records" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            DNS Records
          </TabsTrigger>
          <TabsTrigger value="providers" className="flex items-center gap-2">
            <Server className="h-4 w-4" />
            Providers
          </TabsTrigger>
          <TabsTrigger value="resolutions" className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Resolution History
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="records" className="space-y-4">
          <DnsRecordsSection />
        </TabsContent>

        <TabsContent value="providers" className="space-y-4">
          <DnsProvidersSection />
        </TabsContent>

        <TabsContent value="resolutions" className="space-y-4">
          <DnsResolutionsSection />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <DnsResolutionSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
