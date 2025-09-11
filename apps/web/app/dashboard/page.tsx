"use client";

import { useEffect, useState } from 'react';
import { AppSidebar } from "@/components/app-sidebar"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
    SidebarInset,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar"
import OverviewSection from '../sections/OverviewSection';
import HostsSection from '../sections/HostsSection';
import AutomationsPage from '../automations/page';
import ContainersSection from '../sections/ContainersSection';
import ObservabilitySection from '../sections/ObservabilitySection';
import TopologySection from '../sections/TopologySection';
import SettingsSection from '../sections/SettingsSection';
import CertificatesSection from '../sections/CertificatesSection';
import { ActivityLogSection } from '../sections/ActivityLogSection';
import { TaskDrawer } from '@/components/TaskDrawer';
import LogsSection from '../sections/LogsSection';
import DnsPage from '../dns/page';
import PluginsPage from '../plugins/page';
import { useTaskDrawerStore } from '@/lib/stores/task-drawer-store';
import { ListTodo } from 'lucide-react';

type TabKey = 'overview' | 'hosts' | 'actions' | 'containers' | 'dns' | 'plugins' | 'observability' | 'topology' | 'certificates' | 'logs' | 'activity' | 'settings';

export default function Page() {
    const [tab, setTab] = useState<TabKey>('overview');
    const { actions } = useTaskDrawerStore();

    useEffect(() => {
        const applyFromHash = () => {
        const hash = window.location.hash.slice(1);
        if (['overview', 'hosts', 'actions', 'containers', 'dns', 'plugins', 'observability', 'topology', 'certificates', 'logs', 'activity', 'settings'].includes(hash)) {
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
            case 'plugins': return <PluginsPage />;
            case 'observability': return <ObservabilitySection />;
            case 'topology': return <TopologySection />;
            case 'certificates': return <CertificatesSection />;
            case 'logs': return <LogsSection />;
            case 'activity': return <ActivityLogSection />;
            case 'settings': return <SettingsSection />;
            default: return <HostsSection />;
        }
    };

    return (
        <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-16 shrink-0 items-center gap-2">
                    <div className="flex items-center gap-2 px-4">
                        <SidebarTrigger className="-ml-1" />
                        <Separator
                            orientation="vertical"
                            className="mr-2 data-[orientation=vertical]:h-4"
                        />
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem className="hidden md:block">
                                    <BreadcrumbLink href="#overview">
                                        Dashboard
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator className="hidden md:block" />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>{tab.charAt(0).toUpperCase() + tab.slice(1)}</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    </div>
                </header>
                <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
                    {renderContent()}
                </div>
            </SidebarInset>
            <div className="fixed bottom-4 right-4 z-50">
                <button onClick={actions.toggleOpen} className="rounded-full w-16 h-16 shadow-lg bg-primary text-primary-foreground hover:bg-primary/90">
                    <ListTodo className="h-8 w-8 mx-auto" />
                </button>
            </div>
            <TaskDrawer />
        </SidebarProvider>
    )
}
