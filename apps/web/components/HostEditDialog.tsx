"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { apiClient } from '@/src/lib/api-client';
import { toast } from 'sonner';

interface Host {
  id: string;
  name: string;
  address: string;
  sshUser: string;
  port?: number;
  tags?: string[];
  description?: string;
  role?: 'local' | 'remote';
  sshAuthMethod?: 'password' | 'privateKey';
  sshPassword?: string;
  sshPrivateKey?: string;
  sshPrivateKeyPassphrase?: string;
}

interface HostEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: Host | null;
  mode?: 'edit' | 'create';
  onSuccess?: () => void;
}

export function HostEditDialog({
  open,
  onOpenChange,
  host,
  mode = 'edit',
  onSuccess
}: HostEditDialogProps) {
  const [formData, setFormData] = useState<Partial<Host>>({
    name: '',
    address: '',
    sshUser: 'root',
    port: 22,
    tags: [],
    description: '',
    role: 'local',
    sshAuthMethod: 'password',
    sshPassword: '',
    sshPrivateKey: '',
    sshPrivateKeyPassphrase: ''
  });
  const [newTag, setNewTag] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Initialize form when host changes
  useEffect(() => {
    if (host) {
      setFormData({
        name: host.name,
        address: host.address,
        sshUser: host.sshUser || 'root',
        port: host.port || 22,
        tags: host.tags || [],
        description: host.description || '',
        role: host.role || 'local',
        sshAuthMethod: host.sshAuthMethod || 'password',
        sshPassword: host.sshPassword || '',
        sshPrivateKey: host.sshPrivateKey || '',
        sshPrivateKeyPassphrase: host.sshPrivateKeyPassphrase || ''
      });
      setNewTag('');
    } else if (mode === 'create') {
      // Reset form for create mode
      setFormData({
        name: '',
        address: '',
        sshUser: '',
        port: 22,
        tags: [],
        description: '',
        role: 'local',
        sshAuthMethod: 'password',
        sshPassword: '',
        sshPrivateKey: '',
        sshPrivateKeyPassphrase: ''
      });
      setNewTag('');
    }
  }, [host, mode]);

  const handleInputChange = (field: keyof Host, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags?.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), newTag.trim()]
      }));
      setNewTag('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags?.filter(tag => tag !== tagToRemove) || []
    }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.address || !formData.sshUser) {
      toast.error('请填写必填字段');
      return;
    }

    setIsLoading(true);
    try {
      // 确保私钥以换行符结尾
      const normalizePrivateKey = (key: string | undefined): string | undefined => {
        if (!key || key.trim() === '') return undefined;
        return key.endsWith('\n') ? key : key + '\n';
      };

      let response;
      if (mode === 'edit' && host) {
        response = await apiClient.patch(`/api/v1/hosts/${host.id}`, {
          name: formData.name,
          address: formData.address,
          sshUser: formData.sshUser,
          port: formData.port,
          tags: formData.tags,
          description: formData.description || undefined,
          role: formData.role,
          sshAuthMethod: formData.sshAuthMethod,
          sshPassword: formData.sshPassword || undefined,
          sshPrivateKey: normalizePrivateKey(formData.sshPrivateKey),
          sshPrivateKeyPassphrase: formData.sshPrivateKeyPassphrase || undefined
        });
      } else {
        response = await apiClient.post('/api/v1/hosts', {
          name: formData.name,
          address: formData.address,
          sshUser: formData.sshUser,
          port: formData.port,
          tags: formData.tags,
          description: formData.description,
          role: formData.role,
          sshAuthMethod: formData.sshAuthMethod,
          sshPassword: formData.sshPassword,
          sshPrivateKey: normalizePrivateKey(formData.sshPrivateKey),
          sshPrivateKeyPassphrase: formData.sshPrivateKeyPassphrase
        });
      }

      if (response.success) {
        toast.success(mode === 'edit' ? '主机信息更新成功' : '主机创建成功');
        onOpenChange(false);
        onSuccess?.();
      } else {
        throw new Error(response.error || (mode === 'edit' ? '更新失败' : '创建失败'));
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : (mode === 'edit' ? '更新失败' : '创建失败');
      toast.error(mode === 'edit' ? '主机信息更新失败' : '主机创建失败', { description: errorMessage });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{mode === 'edit' ? '编辑主机' : '新建主机'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">主机名称 *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="输入主机名称"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">主机地址 *</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => handleInputChange('address', e.target.value)}
              placeholder="输入IP地址或域名"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sshUser">SSH用户名 *</Label>
            <Input
              id="sshUser"
              value={formData.sshUser}
              onChange={(e) => handleInputChange('sshUser', e.target.value)}
              placeholder="输入SSH用户名"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="port">SSH端口</Label>
            <Input
              id="port"
              type="number"
              value={formData.port}
              onChange={(e) => handleInputChange('port', parseInt(e.target.value) || 22)}
              placeholder="输入SSH端口"
              min="1"
              max="65535"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">描述</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="输入主机描述（可选）"
            />
          </div>

          <div className="space-y-2">
            <Label>主机角色</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="role"
                  checked={formData.role === 'local'}
                  onChange={() => setFormData(prev => ({ ...prev, role: 'local' }))}
                />
                内网 (Local Network)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="role"
                  checked={formData.role === 'remote'}
                  onChange={() => setFormData(prev => ({ ...prev, role: 'remote' }))}
                />
                公网 (Public Cloud)
              </label>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">认证方式</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="sshAuthMethod"
                  checked={formData.sshAuthMethod === 'password'}
                  onChange={() => setFormData(prev => ({ ...prev, sshAuthMethod: 'password', sshPrivateKey: undefined, sshPrivateKeyPassphrase: undefined }))}
                />
                密码
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="sshAuthMethod"
                  checked={formData.sshAuthMethod === 'privateKey'}
                  onChange={() => setFormData(prev => ({ ...prev, sshAuthMethod: 'privateKey', sshPassword: undefined }))}
                />
                私钥
              </label>
            </div>
          </div>

          {formData.sshAuthMethod === 'password' ? (
            <div className="space-y-2">
              <Label htmlFor="sshPassword">密码</Label>
              <Input
                id="sshPassword"
                type="password"
                value={formData.sshPassword || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, sshPassword: e.target.value }))}
                placeholder="输入SSH密码"
              />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="sshPrivateKey">私钥</Label>
                <Textarea
                  id="sshPrivateKey"
                  value={formData.sshPrivateKey || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, sshPrivateKey: e.target.value }))}
                  placeholder="粘贴私钥 PEM"
                  rows={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sshPrivateKeyPassphrase">私钥口令（可选）</Label>
                <Input
                  id="sshPrivateKeyPassphrase"
                  type="password"
                  value={formData.sshPrivateKeyPassphrase || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, sshPrivateKeyPassphrase: e.target.value }))}
                  placeholder="输入私钥口令（可选）"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label>标签</Label>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="添加标签"
                className="flex-1"
              />
              <Button type="button" onClick={handleAddTag} variant="outline" size="sm">
                添加
              </Button>
            </div>
            {formData.tags && formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {formData.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag}
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
              取消
            </Button>
            <Button type="submit" disabled={isLoading || !formData.name || !formData.address || !formData.sshUser}>
              {isLoading ? (mode === 'edit' ? '保存中...' : '创建中...') : (mode === 'edit' ? '保存' : '创建')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}