"use client"

import * as React from "react"
import {
    Command,
    Settings2,
    Home,
    Server,
    Cpu,
    Activity,
    ServerCog,
    ServerIcon,
    PanelTopCloseIcon,
    LucideWebhook,
    LucideContainer,
    LucideRoute,
    Hash,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"
import { NavProjects } from "./nav-projects"

const data = {
    user: {
        name: "MCP User",
        email: "admin@localhost",
        avatar: "/avatars/default.jpg",
    },
    navMain: [
        {
            title: "Dashboard",
            url: "#overview",
            icon: Home,
            isActive: true,
            items: [
                {
                    title: "Overview",
                    url: "#overview",
                },
                {
                    title: "Actions",
                    url: "#actions",
                },
            ],
        },
        {
            title: "Not yet implemented",
            url: "#",
            icon: Cpu,
            items: [
                {
                    title: "Certificates",
                    url: "#certificates",
                },
                {
                    title: "Observability",
                    url: "#observability",
                },
            ],
        },
        {
            title: "Operations",
            url: "#",
            icon: Activity,
            items: [
                {
                    title: "Activity Log",
                    url: "#activity",
                },
                {
                    title: "Logs",
                    url: "#logs",
                },
            ],
        },
        {
            title: "Settings",
            url: "#settings",
            icon: Settings2,
            items: [
                {
                    title: "General",
                    url: "#settings",
                },
                {
                    title: "Plugins",
                    url: "#plugins",
                },
            ],
        },
    ],
    service: [
        {
            name: "Hosts",
            url: "#hosts",
            icon: ServerCog
        },
        {
            name: "Containers",
            url: "#containers",
            icon: LucideContainer
        },
        {
            name: "DNS",
            url: "#dns",
            icon: LucideRoute
        },
        {
            name: "Topology",
            url: "#topology",
            icon: Hash
        },
    ]
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    return (
        <Sidebar variant="inset" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <a href="#">
                                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                                    <Command className="size-4" />
                                </div>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-medium">MCP</span>
                                    <span className="truncate text-xs">Self-Host Serv Agent</span>
                                </div>
                            </a>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>
            <SidebarContent>
                <NavMain items={data.navMain} />
                <NavProjects projects={data.service}/>
            </SidebarContent>
            <SidebarFooter>
                <NavUser user={data.user} />
            </SidebarFooter>
        </Sidebar>
    )
}
