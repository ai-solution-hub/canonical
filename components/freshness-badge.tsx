'use client';

import { CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type FreshnessState = 'fresh' | 'aging' | 'stale' | 'expired';

interface FreshnessBadgeProps {
  freshness: FreshnessState | string | null;
  className?: string;
  /** Compact variant shows only icon + short label */
  compact?: boolean;
}

const FRESHNESS_CONFIG: Record<
  FreshnessState,
  {
    label: string;
    shortLabel: string;
    icon: typeof CheckCircle2;
    colourClass: string;
  }
> = {
  fresh: {
    label: 'Fresh',
    shortLabel: 'Fresh',
    icon: CheckCircle2,
    colourClass: 'text-freshness-fresh',
  },
  aging: {
    label: 'Aging',
    shortLabel: 'Aging',
    icon: Clock,
    colourClass: 'text-freshness-aging',
  },
  stale: {
    label: 'Stale',
    shortLabel: 'Stale',
    icon: AlertTriangle,
    colourClass: 'text-freshness-stale',
  },
  expired: {
    label: 'Expired',
    shortLabel: 'Expired',
    icon: XCircle,
    colourClass: 'text-freshness-expired',
  },
};

export function FreshnessBadge({
  freshness,
  className,
  compact = false,
}: FreshnessBadgeProps) {
  if (!freshness || !(freshness in FRESHNESS_CONFIG)) {
    return null;
  }

  const config = FRESHNESS_CONFIG[freshness as FreshnessState];
  const Icon = config.icon;
  const label = compact ? config.shortLabel : config.label;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        config.colourClass,
        className,
      )}
      role="img"
      title={`Freshness: ${config.label}`}
      aria-label={`Freshness: ${config.label}`}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
