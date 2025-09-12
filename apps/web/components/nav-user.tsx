"use client"

import { useState, useEffect } from "react"
import {
    ChevronsUpDown,
    LogOut,
    Upload,
} from "lucide-react"
import { toast } from 'sonner'

import {
    Avatar,
    AvatarFallback,
    AvatarImage,
} from "@/components/ui/avatar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar"

export function NavUser({
    user: initialUser,
}: {
    user: {
        name: string
        email: string
        avatar: string
    }
}) {
    const { isMobile } = useSidebar()
    const [user, setUser] = useState(initialUser)

    // Auto-refresh user data to ensure avatar is loaded
    useEffect(() => {
        const refreshUserData = async () => {
            try {
                const { api } = await import('@/src/lib/api-client')
                const userResult = await api.auth.me()
                if (userResult.success && userResult.data) {
                    const userData = userResult.data as any
                    setUser({
                        name: userData.name || initialUser.name,
                        email: userData.email || initialUser.email,
                        avatar: userData.avatarUrl || initialUser.avatar
                    })
                }
            } catch (error) {
                console.error('Failed to refresh user data:', error)
            }
        }

        refreshUserData()
    }, [])

    const handleUploadAvatar = async () => {
        try {
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            
            input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (!file) return

                // Validate file size (1MB limit for Next.js Server Actions)
                const maxSize = 1 * 1024 * 1024 // 1MB
                if (file.size > maxSize) {
                    toast.error('文件大小必须小于1MB')
                    return
                }

                try {
                    const { api } = await import('@/src/lib/api-client')
                    const result = await api.auth.uploadAvatar(file)

                    if (result.success) {
                        // Refresh user data and update component state
                        const { api } = await import('@/src/lib/api-client')
                        const userResult = await api.auth.me()
                        if (userResult.success && userResult.data) {
                            setUser({
                                ...user,
                                avatar: (userResult.data as any).avatarUrl || user.avatar
                            })
                            toast.success('头像上传成功！')
                        } else {
                            console.error('Failed to refresh user data:', userResult.error)
                            toast.error('头像已上传，但刷新显示失败')
                        }
                    } else {
                        console.error('Avatar upload failed:', result.error)
                        toast.error(result.error || '头像上传失败')
                    }
                } catch (error: any) {
                    console.error('Avatar upload error:', error)
                    
                    // Handle specific Next.js Server Action body size limit error
                    if (error?.statusCode === 413 || error?.message?.includes('Body exceeded')) {
                        toast.error('文件大小必须小于1MB')
                    } else {
                        toast.error('头像上传失败，请重试')
                    }
                }
            }

            input.click()
        } catch (error) {
            console.error('Avatar upload error:', error)
        }
    }

    const handleLogout = async () => {
        try {
            // Call logout API endpoint
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
            })

            if (response.ok) {
                // Redirect to login page after successful logout
                window.location.href = '/login'
            } else {
                console.error('Logout failed')
                // Fallback: clear local storage and redirect anyway
                localStorage.clear()
                window.location.href = '/login'
            }
        } catch (error) {
            console.error('Logout error:', error)
            // Fallback: clear local storage and redirect
            localStorage.clear()
            window.location.href = '/login'
        }
    }

    return (
        <SidebarMenu>
            <SidebarMenuItem>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <SidebarMenuButton
                            size="lg"
                            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                        >
                            <Avatar className="h-8 w-8 rounded-lg">
                                <AvatarImage src={user.avatar} alt={user.name} />
                                <AvatarFallback className="rounded-lg">{user.name.charAt(0).toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div className="grid flex-1 text-left text-sm leading-tight">
                                <span className="truncate font-medium">{user.name}</span>
                            </div>
                            <ChevronsUpDown className="ml-auto size-4" />
                        </SidebarMenuButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                        side={isMobile ? "bottom" : "right"}
                        align="end"
                        sideOffset={4}
                    >
                        <DropdownMenuLabel className="p-0 font-normal">
                            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                                <Avatar className="h-8 w-8 rounded-lg">
                                    <AvatarImage src={user.avatar} alt={user.name} />
                                    <AvatarFallback className="rounded-lg">{user.name.charAt(0).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div className="grid flex-1 text-left text-sm leading-tight">
                                    <span className="truncate font-medium">{user.name}</span>
                                </div>
                            </div>
                        </DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleUploadAvatar}>
                            <Upload />
                            Upload Avatar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleLogout}>
                            <LogOut />
                            Log out
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </SidebarMenuItem>
        </SidebarMenu>
    )
}
