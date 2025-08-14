"use client";
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export default function AddToHomeScreen() {
  const [promptEvent, setPromptEvent] = useState<any>(null);
  useEffect(() => {
    const onBeforeInstall = (e: any) => {
      e.preventDefault();
      setPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);
  if (!promptEvent) return null;
  return (
    <Button onClick={async ()=>{ await promptEvent.prompt(); setPromptEvent(null); }}>添加到主屏幕</Button>
  );
}


