'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

async function updateManualPort({ containerId, exposedPort, internalPort }: { containerId: string; exposedPort: string; internalPort: string }) {
  const res = await fetch(`/api/v1/containers/${containerId}/manual-port`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exposedPort, internalPort }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ message: 'Failed to update manual port mapping' }));
    throw new Error(errorData.message);
  }
  return res.json();
}

async function deleteManualPort(containerId: string) {
  const res = await fetch(`/api/v1/containers/${containerId}/manual-port`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ message: 'Failed to delete manual port mapping' }));
    throw new Error(errorData.message);
  }
}

export function ManualPortDialog({
  containerId,
  existingMapping,
  children,
}: {
  containerId: string;
  existingMapping?: { exposedPort: string; internalPort: string } | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [exposedPort, setExposedPort] = useState('');
  const [internalPort, setInternalPort] = useState('');
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open) {
      setExposedPort(existingMapping?.exposedPort || '');
      setInternalPort(existingMapping?.internalPort || '');
    }
  }, [open, existingMapping]);

  const updateMutation = useMutation({
    mutationFn: updateManualPort,
    onSuccess: () => {
      toast.success('端口标记成功');
      queryClient.invalidateQueries({ queryKey: ['containers'] });
      setOpen(false);
    },
    onError: (error) => {
      toast.error(`端口标记失败: ${error.message}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteManualPort,
    onSuccess: () => {
      toast.success('端口标记已清除');
      queryClient.invalidateQueries({ queryKey: ['containers'] });
      setOpen(false);
    },
    onError: (error) => {
      toast.error(`清除失败: ${error.message}`);
    },
  });

  const handleSubmit = () => {
    if (exposedPort && internalPort) {
      updateMutation.mutate({ containerId, exposedPort, internalPort });
    } else {
      toast.warning('请填写所有端口字段');
    }
  };

  const handleClear = () => {
    deleteMutation.mutate(containerId);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>手动标记端口</DialogTitle>
          <DialogDescription>
            为使用 Host 网络或其他无法自动发现端口的容器，手动指定端口映射。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="exposedPort" className="text-right">
              暴露端口
            </Label>
            <Input
              id="exposedPort"
              value={exposedPort}
              onChange={(e) => setExposedPort(e.target.value.replace(/[^0-9]/g, ''))}
              className="col-span-3"
              placeholder="主机上实际访问的端口"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="internalPort" className="text-right">
              内部端口
            </Label>
            <Input
              id="internalPort"
              value={internalPort}
              onChange={(e) => setInternalPort(e.target.value.replace(/[^0-9]/g, ''))}
              className="col-span-3"
              placeholder="容器内监听的端口"
            />
          </div>
        </div>
        <DialogFooter className="justify-between">
          <div>
            {existingMapping && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleClear}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? '清除中...' : '清除'}
              </Button>
            )}
          </div>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
