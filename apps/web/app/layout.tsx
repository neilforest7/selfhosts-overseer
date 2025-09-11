import './globals.css';
import { Toaster } from 'sonner';
import Providers from './providers';

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
          {children}
          <Toaster richColors closeButton />
        </Providers>
        <script dangerouslySetInnerHTML={{__html: `if('serviceWorker' in navigator){window.addEventListener('load',()=>{navigator.serviceWorker.register('/service-worker.js').catch(()=>{})})}`}} />
      </body>
    </html>
  );
}


