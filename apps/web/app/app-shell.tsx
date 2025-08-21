"use client";

import { useEffect, useState } from 'react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import HostsSection from './sections/HostsSection';
import TasksSection from './sections/TasksSection';
import ContainersSection from './sections/ContainersSection';
import ObservabilitySection from './sections/ObservabilitySection';
import TopologySection from './sections/TopologySection';
import SettingsSection from './sections/SettingsSection';
import CertificatesSection from './sections/CertificatesSection';
import LogsSection from './sections/LogsSection';

type TabKey = 'overview' | 'hosts' | 'tasks' | 'containers' | 'observability' | 'topology' | 'certificates' | 'logs' | 'settings';

export default function AppShell() {
  const [tab, setTab] = useState<TabKey>('overview');

  useEffect(() => {
    const applyFromHash = () => {
      const hash = (typeof window !== 'undefined' && window.location.hash.replace('#', '')) as TabKey | '';
      if (hash && ['overview','hosts','tasks','containers','observability','topology','certificates','logs','settings'].includes(hash)) {
        setTab(hash as TabKey);
      }
    };
    applyFromHash();
    const onHash = () => applyFromHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const switchTab = (next: TabKey) => {
    setTab(next);
    if (typeof window !== 'undefined') window.location.hash = next;
  };

  return (
    <div className="grid grid-cols-12 gap-6 h-full">
      <aside className="col-span-12 md:col-span-2">
        <div className="rounded-lg border p-2 space-y-1">
          {([
            ['overview','总览'],
            ['hosts','主机'],
            ['tasks','任务'],
            ['containers','容器'],
            ['observability','观测'],
            ['topology','拓扑'],
            ['certificates','证书'],
            ['logs','日志'],
            ['settings','设置']
          ] as [TabKey, string][]) .map(([key, label]) => (
            <Button key={key} variant={tab === key ? 'default' : 'ghost'} className="w-full justify-start" onClick={() => switchTab(key)}>
              {label}
            </Button>
          ))}
        </div>
      </aside>
      <section className="col-span-12 md:col-span-10 space-y-8">
        {tab === 'overview' && (
          <div className="space-y-6">
            <HostsSection />
            <Separator />
            <TasksSection />
          </div>
        )}
        {tab === 'hosts' && <HostsSection />}
        {tab === 'tasks' && <TasksSection />}
        {tab === 'containers' && <ContainersSection />}
        {tab === 'observability' && <ObservabilitySection />}
        {tab === 'topology' && <TopologySection />}
        {tab === 'certificates' && <CertificatesSection />}
        {tab === 'logs' && <LogsSection />}
        {tab === 'settings' && <SettingsSection />}
      </section>
    </div>
  );
}


