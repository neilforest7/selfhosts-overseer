'use client';

import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Clock, AlertCircle, HelpCircle } from 'lucide-react';

interface DnsStatusBadgeProps {
  status: string;
  className?: string;
}

export function DnsStatusBadge({ status, className }: DnsStatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'RESOLVED':
        return {
          variant: 'default' as const,
          icon: CheckCircle,
          label: 'Resolved',
          className: 'bg-green-100 text-green-800 border-green-200',
        };
      case 'FAILED':
        return {
          variant: 'destructive' as const,
          icon: XCircle,
          label: 'Failed',
          className: 'bg-red-100 text-red-800 border-red-200',
        };
      case 'TIMEOUT':
        return {
          variant: 'secondary' as const,
          icon: Clock,
          label: 'Timeout',
          className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        };
      case 'NO_RECORD':
        return {
          variant: 'outline' as const,
          icon: AlertCircle,
          label: 'No Record',
          className: 'bg-orange-100 text-orange-800 border-orange-200',
        };
      case 'UNKNOWN':
      default:
        return {
          variant: 'secondary' as const,
          icon: HelpCircle,
          label: 'Unknown',
          className: 'bg-gray-100 text-gray-800 border-gray-200',
        };
    }
  };

  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={`${config.className} ${className}`}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  );
}
