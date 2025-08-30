'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

type Host = {
  id: string;
  name: string;
  address: string;
  sshUser: string;
  tags?: string[];
};

interface DiscoverHostsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hosts: Host[];
  onConfirm: (hostIds: string[] | 'all') => void;
  isLoading?: boolean;
}

export function DiscoverHostsDialog({
  open,
  onOpenChange,
  hosts,
  onConfirm,
  isLoading = false
}: DiscoverHostsDialogProps) {
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([]);

  const handleSelectAll = () => {
    if (selectedHostIds.length === hosts.length) {
      // 如果已全选，则取消全选
      setSelectedHostIds([]);
    } else {
      // 否则全选
      setSelectedHostIds(hosts.map(h => h.id));
    }
  };

  const handleHostToggle = (hostId: string) => {
    setSelectedHostIds(prev => 
      prev.includes(hostId) 
        ? prev.filter(id => id !== hostId)
        : [...prev, hostId]
    );
  };

  const handleConfirm = () => {
    if (selectedHostIds.length > 0) {
      onConfirm(selectedHostIds);
      setSelectedHostIds([]);
      onOpenChange(false);
    }
  };

  const handleDiscoverAll = () => {
    onConfirm('all');
    setSelectedHostIds([]);
    onOpenChange(false);
  };

  const handleCancel = () => {
    setSelectedHostIds([]);
    onOpenChange(false);
  };

  const isAllSelected = selectedHostIds.length === hosts.length && hosts.length > 0;
  const isPartialSelected = selectedHostIds.length > 0 && selectedHostIds.length < hosts.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>选择要发现容器的主机</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 mt-2">
          {/* 全选/取消全选 */}
          <div className="flex items-center space-x-2 border-b pb-2">
            <Checkbox
              id="select-all"
              checked={isAllSelected}
              ref={(el) => {
                if (el) {
                  const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement;
                  if (checkbox) checkbox.indeterminate = isPartialSelected;
                }
              }}
              onCheckedChange={handleSelectAll}
            />
            <label htmlFor="select-all" className="text-sm font-medium cursor-pointer">
              {isAllSelected ? '取消全选' : '全选'} ({hosts.length} 台主机)
            </label>
          </div>

          {/* 主机列表 */}
          <ScrollArea className="">
            <div className="space-y-2">
              {hosts.map((host) => (
                <div key={host.id} className="flex items-center space-x-2 p-2 rounded-md hover:bg-muted">
                  <Checkbox
                    id={`host-${host.id}`}
                    checked={selectedHostIds.includes(host.id)}
                    onCheckedChange={() => handleHostToggle(host.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 align-middle flex-row">
                      <label htmlFor={`host-${host.id}`} className="text-sm font-medium cursor-pointer block">
                        {host.name}
                      </label>
                      {host.tags && host.tags.length > 0 && (
                        <div className="flex gap-1">
                          {host.tags.map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {host.sshUser}@{host.address}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* 选择状态 */}
          {selectedHostIds.length > 0 && (
            <div className="text-sm text-muted-foreground">
              已选择 {selectedHostIds.length} 台主机
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={handleCancel} disabled={isLoading}>
            取消
          </Button>
          <Button variant="secondary" onClick={handleDiscoverAll} disabled={isLoading}>
            全部主机
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={selectedHostIds.length === 0 || isLoading}
          >
            {isLoading ? '发现中...' : `发现容器 (${selectedHostIds.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
