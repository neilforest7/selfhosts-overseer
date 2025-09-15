"use client";

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, Filter } from 'lucide-react';
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
  dnsResolutionFrequencyMinutes: number;
  dnsSkipNonAddressRecords: boolean;
};

// Frequency options for DNS resolution
const FREQUENCY_OPTIONS = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 720, label: 'Every 12 hours' },
  { value: 1440, label: 'Every 24 hours' },
];

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

  // DNS 解析设置状态
  const [dnsResolutionFrequencyMinutes, setDnsResolutionFrequencyMinutes] = useState(60);
  const [dnsSkipNonAddressRecords, setDnsSkipNonAddressRecords] = useState(false);

  useEffect(() => {
    if (sQuery.data) {
      setSshConcurrency(sQuery.data.sshConcurrency);
      setTimeoutSec(sQuery.data.commandTimeoutSeconds);
      setDockerProxyEnabled(sQuery.data.dockerProxyEnabled || false);
      setDockerProxyHost(sQuery.data.dockerProxyHost || '');
      setDockerProxyPort(sQuery.data.dockerProxyPort || 8080);
      setDockerProxyUsername(sQuery.data.dockerProxyUsername || '');
      setDockerProxyPassword(sQuery.data.dockerProxyPassword || '');
      setDnsResolutionFrequencyMinutes(sQuery.data.dnsResolutionFrequencyMinutes || 60);
      setDnsSkipNonAddressRecords(sQuery.data.dnsSkipNonAddressRecords || false);
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

        <Separator />

        {/* DNS 解析设置 */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <h3 className="text-lg font-medium">DNS 解析设置</h3>
          </div>

          <div className="grid gap-4 max-w-md">
            <div className="grid gap-2">
              <Label htmlFor="dns-frequency" className="text-sm">解析频率</Label>
              <Select
                value={dnsResolutionFrequencyMinutes.toString()}
                onValueChange={(value) => setDnsResolutionFrequencyMinutes(parseInt(value, 10))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择频率" />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value.toString()}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                系统检查和解析 DNS 记录的频率。较低的频率提供更实时的监控但消耗更多资源。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                <Label className="text-sm">记录类型过滤</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="skip-non-standard"
                  checked={dnsSkipNonAddressRecords}
                  onCheckedChange={(checked) => setDnsSkipNonAddressRecords(checked as boolean)}
                />
                <Label htmlFor="skip-non-standard" className="text-sm">
                  解析时跳过非标准 DNS 记录类型
                </Label>
              </div>

              <p className="text-xs text-muted-foreground">
                启用后，只解析标准 DNS 记录类型（A、AAAA、CNAME），跳过专用类型如 MX、TXT、NS、PTR、SRV 和 CAA。这通过专注于最常用的记录类型来提高性能。
              </p>
            </div>
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
              dockerProxyPassword: dockerProxyPassword.trim(),
              dnsResolutionFrequencyMinutes,
              dnsSkipNonAddressRecords
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
                setDnsResolutionFrequencyMinutes(sQuery.data.dnsResolutionFrequencyMinutes || 60);
                setDnsSkipNonAddressRecords(sQuery.data.dnsSkipNonAddressRecords || false);
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


