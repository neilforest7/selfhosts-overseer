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
  dockerProxyLocalOnly: boolean;
  dockerCredentialsEnabled: boolean;
  dockerCredentialsUsername: string;
  dockerCredentialsPersonalAccessToken: string;
};

export default function SettingsSection() {
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
  const [dockerProxyLocalOnly, setDockerProxyLocalOnly] = useState(true);
  
  // Docker 凭证设置状态
  const [dockerCredentialsEnabled, setDockerCredentialsEnabled] = useState(false);
  const [dockerCredentialsUsername, setDockerCredentialsUsername] = useState('');
  const [dockerCredentialsPersonalAccessToken, setDockerCredentialsPersonalAccessToken] = useState('');

  useEffect(() => {
    if (sQuery.data) {
      setSshConcurrency(sQuery.data.sshConcurrency);
      setTimeoutSec(sQuery.data.commandTimeoutSeconds);
      setDockerProxyEnabled(sQuery.data.dockerProxyEnabled || false);
      setDockerProxyHost(sQuery.data.dockerProxyHost || '');
      setDockerProxyPort(sQuery.data.dockerProxyPort || 8080);
      setDockerProxyUsername(sQuery.data.dockerProxyUsername || '');
              setDockerProxyPassword(sQuery.data.dockerProxyPassword || '');
        setDockerProxyLocalOnly(sQuery.data.dockerProxyLocalOnly !== undefined ? sQuery.data.dockerProxyLocalOnly : true);
        
        // 初始化 Docker 凭证设置
        setDockerCredentialsEnabled(sQuery.data.dockerCredentialsEnabled || false);
        setDockerCredentialsUsername(sQuery.data.dockerCredentialsUsername || '');
        setDockerCredentialsPersonalAccessToken(sQuery.data.dockerCredentialsPersonalAccessToken || '');
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
          
          <div className="flex items-center space-x-2 ml-6">
            <Checkbox 
              id="docker-proxy-local-only" 
              checked={dockerProxyLocalOnly} 
              onCheckedChange={(checked) => setDockerProxyLocalOnly(checked === true)}
              disabled={!dockerProxyEnabled}
            />
            <Label htmlFor="docker-proxy-local-only" className={!dockerProxyEnabled ? 'text-muted-foreground' : ''}>
              仅对标签含有"local"的主机应用代理
            </Label>
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

      <Separator />

      {/* Docker 凭证设置 */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Docker 凭证设置</h3>
        
        <div className="flex items-center space-x-2">
          <Checkbox 
            id="docker-credentials-enabled" 
            checked={dockerCredentialsEnabled} 
            onCheckedChange={(checked) => setDockerCredentialsEnabled(checked === true)} 
          />
          <Label htmlFor="docker-credentials-enabled">启用 DockerHub 凭证</Label>
        </div>
        
        <div className={`grid gap-4 max-w-md ml-6 transition-opacity duration-200 ${dockerCredentialsEnabled ? 'opacity-100' : 'opacity-50'}`}>
          <div className="grid gap-2">
            <Label htmlFor="credentials-username">用户名 *</Label>
            <Input 
              id="credentials-username"
              type="text" 
              placeholder="例如：yourusername" 
              value={dockerCredentialsUsername} 
              onChange={(e) => setDockerCredentialsUsername(e.target.value)}
              disabled={!dockerCredentialsEnabled}
            />
          </div>
          
          <div className="grid gap-2">
            <Label htmlFor="credentials-token">Personal Access Token *</Label>
            <Input 
              id="credentials-token"
              type="password" 
              placeholder="输入 Personal Access Token" 
              value={dockerCredentialsPersonalAccessToken} 
              onChange={(e) => setDockerCredentialsPersonalAccessToken(e.target.value)}
              disabled={!dockerCredentialsEnabled}
            />
          </div>

          {!dockerCredentialsEnabled && (
            <div className="text-xs text-muted-foreground italic">
              启用 Docker 凭证后可配置以上选项
            </div>
          )}
          
          {dockerCredentialsEnabled && dockerCredentialsUsername && dockerCredentialsPersonalAccessToken && (
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={async () => {
                  try {
                    const response = await fetch('http://localhost:3001/api/v1/containers/test-credentials', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        username: dockerCredentialsUsername,
                        personalAccessToken: dockerCredentialsPersonalAccessToken
                      })
                    });
                    
                    if (response.ok) {
                      toast.success('Docker Hub 登录成功');
                    } else {
                      const error = await response.text();
                      toast.error(`Docker Hub 凭证测试失败: ${error}`);
                    }
                  } catch (error) {
                    toast.error('Docker Hub 凭证测试失败: 网络错误或服务不可用');
                  }
                }}
              >
                在本地测试凭证
              </Button>
              <span className="text-xs text-muted-foreground">
                点击测试 Docker Hub 登录是否成功
              </span>
            </div>
          )}
        </div>
      </div>

        <Separator />
      
        <div className="flex gap-2">
          <Button 
            onClick={() => save.mutate({
              sshConcurrency: validConcurrency,
              commandTimeoutSeconds: validTimeout,
              dockerProxyEnabled,
              dockerProxyHost: dockerProxyHost.trim(),
              dockerProxyPort: validProxyPort,
              dockerProxyUsername: dockerProxyUsername.trim(),
              dockerProxyPassword: dockerProxyPassword.trim(),
              dockerProxyLocalOnly,
              dockerCredentialsEnabled,
              dockerCredentialsUsername: dockerCredentialsUsername.trim(),
              dockerCredentialsPersonalAccessToken: dockerCredentialsPersonalAccessToken.trim()
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
                setDockerProxyLocalOnly(sQuery.data.dockerProxyLocalOnly !== undefined ? sQuery.data.dockerProxyLocalOnly : true);
                
                // 重置 Docker 凭证设置
                setDockerCredentialsEnabled(sQuery.data.dockerCredentialsEnabled || false);
                setDockerCredentialsUsername(sQuery.data.dockerCredentialsUsername || '');
                setDockerCredentialsPersonalAccessToken(sQuery.data.dockerCredentialsPersonalAccessToken || '');
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


