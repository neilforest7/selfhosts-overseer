"use client";

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';

type Settings = { 
  sshConcurrency: number; 
  commandTimeoutSeconds: number; 
  containerUpdateCheckCron: string;
  dockerProxyEnabled: boolean;
  dockerProxyHost: string;
  dockerProxyPort: number;
  dockerProxyUsername: string;
  dockerProxyPassword: string;
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const sQuery = useQuery<Settings>({
    queryKey: ['settings'],
    queryFn: async () => {
      const r = await fetch('http://localhost:3001/api/v1/settings');
      if (!r.ok) throw new Error('加载失败');
      return r.json();
    }
  });

  const [sshConcurrency, setSshConcurrency] = useState(30);
  const [commandTimeoutSeconds, setTimeoutSec] = useState(100);
  
  // Docker 代理设置状态
  const [dockerProxyEnabled, setDockerProxyEnabled] = useState(false);
  const [dockerProxyHost, setDockerProxyHost] = useState('');
  const [dockerProxyPort, setDockerProxyPort] = useState(8080);
  const [dockerProxyUsername, setDockerProxyUsername] = useState('');
  const [dockerProxyPassword, setDockerProxyPassword] = useState('');

  useEffect(() => {
    if (sQuery.data) {
      setSshConcurrency(sQuery.data.sshConcurrency);
      setTimeoutSec(sQuery.data.commandTimeoutSeconds);
      setDockerProxyEnabled(sQuery.data.dockerProxyEnabled || false);
      setDockerProxyHost(sQuery.data.dockerProxyHost || '');
      setDockerProxyPort(sQuery.data.dockerProxyPort || 8080);
      setDockerProxyUsername(sQuery.data.dockerProxyUsername || '');
      setDockerProxyPassword(sQuery.data.dockerProxyPassword || '');
    }
  }, [sQuery.data]);

  const save = useMutation({
    mutationFn: async (body: Partial<Settings>) => {
      const r = await fetch('http://localhost:3001/api/v1/settings', { method: 'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('保存失败');
      return r.json() as Promise<Settings>;
    },
    onSuccess: () => { toast.success('已保存'); qc.invalidateQueries({ queryKey: ['settings'] }); }
  });

  const validConcurrency = Math.min(100, Math.max(10, sshConcurrency));
  const validTimeout = Math.min(900, Math.max(10, commandTimeoutSeconds));
  const validProxyPort = Math.min(65535, Math.max(1, dockerProxyPort));

  return (
    <Card>
      <CardHeader><CardTitle>设置</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 max-w-xs">
          <label className="text-sm">SSH 并发（10–100）</label>
          <Input type="number" value={sshConcurrency} onChange={(e)=>setSshConcurrency(Number(e.target.value))} />
        </div>
        <div className="grid gap-2 max-w-xs">
          <label className="text-sm">命令超时（10–900 秒）</label>
          <Input type="number" value={commandTimeoutSeconds} onChange={(e)=>setTimeoutSec(Number(e.target.value))} />
        </div>
        
        <Separator />
        
        {/* Docker 代理设置 */}
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Docker 代理设置</h3>
          
          <div className="flex items-center space-x-2">
            <Checkbox 
              id="docker-proxy-enabled" 
              checked={dockerProxyEnabled} 
              onCheckedChange={(checked) => setDockerProxyEnabled(checked === true)} 
            />
            <Label htmlFor="docker-proxy-enabled">启用 Docker 代理（用于连接 docker.io）</Label>
          </div>
          
          <div className={`grid gap-4 max-w-md ml-6 transition-opacity duration-200 ${dockerProxyEnabled ? 'opacity-100' : 'opacity-50'}`}>
            <div className="grid gap-2">
              <Label htmlFor="proxy-host">代理服务器地址 *</Label>
              <Input 
                id="proxy-host"
                type="text" 
                placeholder="例如：proxy.example.com" 
                value={dockerProxyHost} 
                onChange={(e) => setDockerProxyHost(e.target.value)}
                disabled={!dockerProxyEnabled}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="proxy-port">代理端口（1–65535）</Label>
              <Input 
                id="proxy-port"
                type="number" 
                value={dockerProxyPort} 
                onChange={(e) => setDockerProxyPort(Number(e.target.value))}
                disabled={!dockerProxyEnabled}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="proxy-username">用户名（可选）</Label>
              <Input 
                id="proxy-username"
                type="text" 
                value={dockerProxyUsername} 
                onChange={(e) => setDockerProxyUsername(e.target.value)}
                disabled={!dockerProxyEnabled}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="proxy-password">密码（可选）</Label>
              <Input 
                id="proxy-password"
                type="password" 
                value={dockerProxyPassword} 
                onChange={(e) => setDockerProxyPassword(e.target.value)}
                disabled={!dockerProxyEnabled}
              />
            </div>
            
            {!dockerProxyEnabled && (
              <div className="text-xs text-muted-foreground italic">
                启用 Docker 代理后可配置以上选项
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => save.mutate({ 
              sshConcurrency: validConcurrency, 
              commandTimeoutSeconds: validTimeout,
              dockerProxyEnabled,
              dockerProxyHost: dockerProxyHost.trim(),
              dockerProxyPort: validProxyPort,
              dockerProxyUsername: dockerProxyUsername.trim(),
              dockerProxyPassword: dockerProxyPassword.trim()
            })} 
            disabled={save.isPending}
          >
            保存
          </Button>
          <Button 
            variant="secondary" 
            onClick={() => { 
              if (sQuery.data) { 
                setSshConcurrency(sQuery.data.sshConcurrency); 
                setTimeoutSec(sQuery.data.commandTimeoutSeconds);
                setDockerProxyEnabled(sQuery.data.dockerProxyEnabled || false);
                setDockerProxyHost(sQuery.data.dockerProxyHost || '');
                setDockerProxyPort(sQuery.data.dockerProxyPort || 8080);
                setDockerProxyUsername(sQuery.data.dockerProxyUsername || '');
                setDockerProxyPassword(sQuery.data.dockerProxyPassword || '');
              } 
            }}
          >
            重置
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}


