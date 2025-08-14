import './globals.css';
import { Toaster } from 'sonner';
import Providers from './providers';
import AppShell from './app-shell';
import AddToHomeScreen from '@/components/AddToHomeScreen';

export const metadata = {
  title: 'Self-Host Serv Agent',
  description: '单用户、自托管的跨 VPS 控制平面',
  manifest: '/manifest.webmanifest'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning className="min-h-screen bg-background text-foreground">
        <Providers>
        <main className="container py-6 space-y-8">
          <AddToHomeScreen />
          <div className="rounded-lg border p-4">
            {/* 单页应用主体 */}
            {/* 侧边栏 + 内容 */}
            {/* 渲染 AppShell，其中包含侧边切换与各区块 */}
            {/* 为确保 SSR 稳定性，AppShell 完全在客户端渲染 */}
            <AppShell />
          </div>
          {children}
        </main>
        <Toaster richColors closeButton />
        </Providers>
        <script dangerouslySetInnerHTML={{__html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/service-worker.js').catch(()=>{})})}`}} />
      </body>
    </html>
  );
}


