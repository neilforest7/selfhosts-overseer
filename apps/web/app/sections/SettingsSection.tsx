"use client";

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import AddToHomeScreen from '@/components/AddToHomeScreen';



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
  ghcrCredentialsEnabled: boolean;
  ghcrUsername: string;
  ghcrPersonalAccessToken: string;
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

  // GHCR 凭证设置状态
  const [ghcrCredentialsEnabled, setGhcrCredentialsEnabled] = useState(false);
  const [ghcrUsername, setGhcrUsername] = useState('');
  const [ghcrPersonalAccessToken, setGhcrPersonalAccessToken] = useState('');

  // 代理验证和测试状态
  const [proxyValidation, setProxyValidation] = useState<{
    isValid: boolean;
    message: string;
    type: 'success' | 'error' | 'warning' | 'info';
  } | null>(null);
  const [isTestingProxy, setIsTestingProxy] = useState(false);
  const [proxyTestResult, setProxyTestResult] = useState<{
    success: boolean;
    message: string;
    timestamp: Date;
  } | null>(null);

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

        // 初始化 GHCR 凭证设置
        setGhcrCredentialsEnabled(sQuery.data.ghcrCredentialsEnabled || false);
        setGhcrUsername(sQuery.data.ghcrUsername || '');
        setGhcrPersonalAccessToken(sQuery.data.ghcrPersonalAccessToken || '');
    }
  }, [sQuery.data]);

  // 代理地址验证函数
  const validateProxyAddress = (host: string): { isValid: boolean; message: string; type: 'success' | 'error' | 'warning' | 'info' } => {
    if (!host.trim()) {
      return { isValid: false, message: '代理地址不能为空', type: 'error' };
    }

    // 移除协议前缀（如果存在）
    const cleanHost = host.replace(/^https?:\/\//, '');

    // 检查是否包含端口
    const hasPort = cleanHost.includes(':');

    // 基本格式验证
    const hostPattern = /^[a-zA-Z0-9.-]+(\.[a-zA-Z]{2,})?$/;
    const hostWithPortPattern = /^[a-zA-Z0-9.-]+(\.[a-zA-Z]{2,})?:\d{1,5}$/;
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipWithPortPattern = /^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/;

    const hostPart = hasPort ? cleanHost.split(':')[0] : cleanHost;
    const portPart = hasPort ? cleanHost.split(':')[1] : null;

    // 验证主机部分
    if (!hostPattern.test(hostPart) && !ipPattern.test(hostPart)) {
      return { isValid: false, message: '代理地址格式无效。请使用域名或IP地址', type: 'error' };
    }

    // 验证端口部分（如果存在）
    if (portPart) {
      const port = parseInt(portPart);
      if (isNaN(port) || port < 1 || port > 65535) {
        return { isValid: false, message: '端口号必须在 1-65535 范围内', type: 'error' };
      }
    }

    // 提供格式建议
    if (host.startsWith('http://') || host.startsWith('https://')) {
      return {
        isValid: true,
        message: '建议移除协议前缀，只使用主机名和端口',
        type: 'warning'
      };
    }

    if (!hasPort && dockerProxyPort === 8080) {
      return {
        isValid: true,
        message: `格式正确。将使用端口 ${dockerProxyPort}`,
        type: 'info'
      };
    }

    return { isValid: true, message: '代理地址格式正确', type: 'success' };
  };

  // 测试 Docker Hub 连接
  const testDockerHubConnectivity = async () => {
    if (!dockerProxyHost.trim()) {
      toast.error('请先输入代理地址');
      return;
    }

    setIsTestingProxy(true);
    setProxyTestResult(null);

    try {
      const response = await fetch('http://localhost:3001/api/v1/settings/test-docker-hub-connectivity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyHost: dockerProxyHost,
          proxyPort: dockerProxyPort,
          proxyUsername: dockerProxyUsername || undefined,
          proxyPassword: dockerProxyPassword || undefined,
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        setProxyTestResult({
          success: true,
          message: result.message || 'Docker Hub 连接测试成功',
          timestamp: new Date(),
        });
        toast.success('Docker Hub 连接测试成功');
      } else {
        setProxyTestResult({
          success: false,
          message: result.message || result.error || 'Docker Hub 连接测试失败',
          timestamp: new Date(),
        });
        toast.error(`Docker Hub 连接测试失败: ${result.message || result.error}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      setProxyTestResult({
        success: false,
        message: `网络错误: ${errorMessage}`,
        timestamp: new Date(),
      });
      toast.error(`测试失败: ${errorMessage}`);
    } finally {
      setIsTestingProxy(false);
    }
  };

  // 监听代理地址变化并验证
  useEffect(() => {
    if (dockerProxyEnabled && dockerProxyHost) {
      const validation = validateProxyAddress(dockerProxyHost);
      setProxyValidation(validation);
    } else {
      setProxyValidation(null);
    }
  }, [dockerProxyHost, dockerProxyEnabled, dockerProxyPort]);

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
    <div className="space-y-6">
      {/* 基础设置 Card */}
      <Card>
        <CardHeader><CardTitle>基础设置</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <AddToHomeScreen />
          <div className="grid gap-2 max-w-xs">
            <label className="text-sm">SSH 并发（10–100）</label>
            <Input type="number" value={sshConcurrency} onChange={(e)=>setSshConcurrency(Number(e.target.value))} />
          </div>
          <div className="grid gap-2 max-w-xs">
            <label className="text-sm">命令超时（10–900 秒）</label>
            <Input type="number" value={commandTimeoutSeconds} onChange={(e)=>setTimeoutSec(Number(e.target.value))} />
          </div>
        </CardContent>
      </Card>

      {/* Docker 代理设置 Card */}
      <Card>
        <CardHeader><CardTitle>Docker 代理设置</CardTitle></CardHeader>
        <CardContent className="space-y-6">
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
              仅对role为'本地主机'的主机应用代理
            </Label>
          </div>
          
          <div className={`grid gap-4 max-w-md ml-6 transition-opacity duration-200 ${dockerProxyEnabled ? 'opacity-100' : 'opacity-50'}`}>
            <div className="grid gap-2">
              <Label htmlFor="proxy-host">代理服务器地址 *</Label>
              <div className="space-y-2">
                <Input
                  id="proxy-host"
                  type="text"
                  placeholder="例如：proxy.example.com:8080 或 192.168.1.100:3128"
                  value={dockerProxyHost}
                  onChange={(e) => setDockerProxyHost(e.target.value)}
                  disabled={!dockerProxyEnabled}
                  className={proxyValidation?.type === 'error' ? 'border-red-500' :
                            proxyValidation?.type === 'warning' ? 'border-yellow-500' :
                            proxyValidation?.type === 'success' ? 'border-green-500' : ''}
                />

                {/* 格式提示 */}
                <div className="text-sm text-muted-foreground">
                  <p>支持的格式：</p>
                  <ul className="list-disc list-inside ml-2 space-y-1">
                    <li><code>proxy.company.com</code> (使用下方端口设置)</li>
                    <li><code>proxy.company.com:8080</code> (包含端口)</li>
                    <li><code>192.168.1.100:3128</code> (IP地址和端口)</li>
                  </ul>
                </div>

                {/* 验证结果显示 */}
                {proxyValidation && (
                  <Alert className={`${
                    proxyValidation.type === 'error' ? 'border-red-200 bg-red-50' :
                    proxyValidation.type === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                    proxyValidation.type === 'success' ? 'border-green-200 bg-green-50' :
                    'border-blue-200 bg-blue-50'
                  }`}>
                    <div className="flex items-center gap-2">
                      {proxyValidation.type === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
                      {proxyValidation.type === 'warning' && <AlertCircle className="h-4 w-4 text-yellow-600" />}
                      {proxyValidation.type === 'success' && <CheckCircle className="h-4 w-4 text-green-600" />}
                      {proxyValidation.type === 'info' && <AlertCircle className="h-4 w-4 text-blue-600" />}
                      <AlertDescription className={`${
                        proxyValidation.type === 'error' ? 'text-red-700' :
                        proxyValidation.type === 'warning' ? 'text-yellow-700' :
                        proxyValidation.type === 'success' ? 'text-green-700' :
                        'text-blue-700'
                      }`}>
                        {proxyValidation.message}
                      </AlertDescription>
                    </div>
                  </Alert>
                )}

              </div>
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
            
            {/* 测试连接按钮 */}
            {dockerProxyEnabled && dockerProxyHost && proxyValidation?.isValid && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={testDockerHubConnectivity}
                  disabled={isTestingProxy}
                  className="flex items-center gap-2"
                >
                  {isTestingProxy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4" />
                  )}
                  {isTestingProxy ? '测试中...' : '测试 Docker Hub 连接'}
                </Button>

                {/* {proxyTestResult && (
                  <Badge variant={proxyTestResult.success ? 'default' : 'destructive'}>
                    {proxyTestResult.success ? '连接成功' : '连接失败'}
                  </Badge>
                )} */}
              </div>
            )}

            {/* 测试结果详情 */}
            {proxyTestResult && (
              <Alert className={proxyTestResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
                <div className="flex items-center gap-2">
                  {proxyTestResult.success ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-600" />
                  )}
                  <div className="flex-1">
                    <AlertDescription className={proxyTestResult.success ? 'text-green-700' : 'text-red-700'}>
                      {proxyTestResult.message}
                    </AlertDescription>
                    <p className="text-xs text-muted-foreground mt-1">
                      测试时间: {proxyTestResult.timestamp.toLocaleString()}
                    </p>
                  </div>
                </div>
              </Alert>
            )}
          {!dockerProxyEnabled && (
            <div className="text-xs text-muted-foreground italic">
              启用 Docker 代理后可配置以上选项
            </div>
          )}
        </div>
        </CardContent>
      </Card>

      {/* 凭证设置区域 - 使用 grid-cols-2 布局 */}
      <div className='grid grid-cols-2 gap-6'>
        {/* Docker 凭证设置 Card */}
        <Card>
          <CardHeader><CardTitle>Docker 凭证设置</CardTitle></CardHeader>
          <CardContent className="space-y-6 my-2">
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
          </CardContent>
        </Card>

        {/* GHCR 凭证设置 Card */}
        <Card>
          <CardHeader><CardTitle>GHCR 凭证设置</CardTitle></CardHeader>
          <CardContent className="space-y-6 my-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="ghcr-credentials-enabled"
                checked={ghcrCredentialsEnabled}
                onCheckedChange={(checked) => setGhcrCredentialsEnabled(checked === true)}
              />
              <Label htmlFor="ghcr-credentials-enabled">启用 GitHub Container Registry (GHCR) 凭证</Label>
            </div>

            <div className={`grid gap-4 max-w-md ml-6 transition-opacity duration-200 ${ghcrCredentialsEnabled ? 'opacity-100' : 'opacity-50'}`}>
              <div className="grid gap-2">
                <Label htmlFor="ghcr-username">GitHub 用户名 *</Label>
                <Input
                  id="ghcr-username"
                  type="text"
                  placeholder="例如：yourusername"
                  value={ghcrUsername}
                  onChange={(e) => setGhcrUsername(e.target.value)}
                  disabled={!ghcrCredentialsEnabled}
                />
              </div>

              <div className="grid gap-2">
                <div className="flex flex-row justify-between">
                  <Label htmlFor="ghcr-token">GitHub Personal Access Token *</Label>
                  <div className="text-xs text-muted-foreground">
                    需要包含 <code className="bg-muted px-1 py-0.5 rounded">read:packages</code> 权限
                  </div>
                </div>
                <Input
                  id="ghcr-token"
                  type="password"
                  placeholder="输入 GitHub Personal Access Token"
                  value={ghcrPersonalAccessToken}
                  onChange={(e) => setGhcrPersonalAccessToken(e.target.value)}
                  disabled={!ghcrCredentialsEnabled}
                />
              </div>

              {!ghcrCredentialsEnabled && (
                <div className="text-xs text-muted-foreground italic">
                  启用 GHCR 凭证后可配置以上选项
                </div>
              )}

              {ghcrCredentialsEnabled && ghcrUsername && ghcrPersonalAccessToken && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        const response = await fetch('http://localhost:3001/api/v1/settings/test-ghcr-connectivity', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            username: ghcrUsername,
                            personalAccessToken: ghcrPersonalAccessToken
                          })
                        });

                        const result = await response.json();

                        if (response.ok && result.success) {
                          toast.success('GHCR 连接成功');
                        } else {
                          toast.error(`GHCR 凭证测试失败: ${result.message}`);
                        }
                      } catch (error) {
                        toast.error('GHCR 凭证测试失败: 网络错误或服务不可用');
                      }
                    }}
                  >
                    测试 GHCR 连接
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    点击测试 GHCR 认证是否成功
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 操作按钮 Card */}
          <div className="flex gap-3 p-4">
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
                dockerCredentialsPersonalAccessToken: dockerCredentialsPersonalAccessToken.trim(),
                ghcrCredentialsEnabled,
                ghcrUsername: ghcrUsername.trim(),
                ghcrPersonalAccessToken: ghcrPersonalAccessToken.trim()
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

                  // 重置 GHCR 凭证设置
                  setGhcrCredentialsEnabled(sQuery.data.ghcrCredentialsEnabled || false);
                  setGhcrUsername(sQuery.data.ghcrUsername || '');
                  setGhcrPersonalAccessToken(sQuery.data.ghcrPersonalAccessToken || '');
            } 
              }}
            >
              重置
            </Button>
          </div>
    </div>
  );
}


