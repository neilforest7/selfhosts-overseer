"use client";

import { useEffect, useState } from 'react';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import OverviewSection from './sections/OverviewSection';
import HostsSection from './sections/HostsSection';
import AutomationsPage from './automations/page';
import ContainersSection from './sections/ContainersSection';
import ObservabilitySection from './sections/ObservabilitySection';
import TopologySection from './sections/TopologySection';
import SettingsSection from './sections/SettingsSection';
import CertificatesSection from './sections/CertificatesSection';
import { ActivityLogSection } from './sections/ActivityLogSection';
import { TaskDrawer } from '@/components/TaskDrawer';
import LogsSection from './sections/LogsSection';
import DnsPage from './dns/page';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';
import { ListTodo } from 'lucide-react';

type TabKey = 'overview' | 'hosts' | 'actions' | 'containers' | 'dns' | 'observability' | 'topology' | 'certificates' | 'logs' | 'activity' | 'settings';

export default function AppShell() {
    const [tab, setTab] = useState<TabKey>('overview');
    const { actions } = useTaskDrawerStore();

    useEffect(() => {
        const applyFromHash = () => {
        const hash = window.location.hash.slice(1);
        if (['overview', 'hosts', 'actions', 'containers', 'dns', 'observability', 'topology', 'certificates', 'logs', 'activity', 'settings'].includes(hash)) {
            setTab(hash as TabKey);
        }
        };
        applyFromHash();
        window.addEventListener('hashchange', applyFromHash);
        return () => window.removeEventListener('hashchange', applyFromHash);
    }, []);

    const renderContent = () => {
        switch (tab) {
            case 'overview': return <OverviewSection />;
            case 'hosts': return <HostsSection />;
            case 'actions': return <AutomationsPage />;
            case 'containers': return <ContainersSection />;
            case 'dns': return <DnsPage />;
            case 'observability': return <ObservabilitySection />;
            case 'topology': return <TopologySection />;
            case 'certificates': return <CertificatesSection />;
            case 'logs': return <LogsSection />;
            case 'activity': return <ActivityLogSection showFilters={true} limit={100} title="All Activities" />;
            case 'settings': return <SettingsSection />;
            default: return <HostsSection />;
        }
    };

    return (
        <>
        <div className="flex h-full bg-background text-foreground">
            <nav className="w-48 border-r p-4 space-y-2">
            <h1 className="text-lg font-bold mb-4">MCP</h1>
            {(['overview', 'hosts', 'containers','dns','topology','logs','activity','actions','certificates','observability','settings'] as TabKey[]).map(t => {
                const labels: Record<TabKey, string> = {
                    overview: 'Overview',
                    hosts: 'Hosts',
                    containers: 'Containers',
                    dns: 'DNS',
                    topology: 'Topology',
                    logs: 'Logs',
                    activity: 'Activity',
                    actions: 'Actions',
                    certificates: 'Certificates',
                    observability: 'Observability',
                    settings: 'Settings'
                };
                return (
                    <a key={t} href={`#${t}`} onClick={() => setTab(t)} className={`block px-3 py-2 rounded-md text-sm font-medium ${tab === t ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                        {labels[t]}
                    </a>
                );
            })}
            </nav>
            <section className="flex-1 p-6 overflow-auto">
            {renderContent()}
            </section>
        </div>
        <div className="fixed bottom-4 right-4 z-50">
            <Button onClick={actions.toggleOpen} size="lg" className="rounded-full w-16 h-16 shadow-lg">
            <ListTodo className="h-8 w-8" />
            </Button>
        </div>
        <TaskDrawer />
        </>
    );
}
