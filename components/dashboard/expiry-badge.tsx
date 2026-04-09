import { cn } from '@/lib/utils';
import type { ExpiryStatus } from '@/lib/certification-status';

const EXPIRY_BADGE_CONFIG: Record<
  ExpiryStatus,
  { label: string; textClass: string; bgClass: string }
> = {
  valid: {
    label: 'Valid',
    textClass: 'text-freshness-fresh',
    bgClass: 'bg-freshness-fresh-bg',
  },
  expiring_soon: {
    label: 'Expiring Soon',
    textClass: 'text-freshness-aging',
    bgClass: 'bg-freshness-aging-bg',
  },
  expired: {
    label: 'Expired',
    textClass: 'text-freshness-expired',
    bgClass: 'bg-freshness-expired-bg',
  },
  unknown: {
    label: 'No expiry date',
    textClass: 'text-muted-foreground',
    bgClass: 'bg-muted',
  },
};

interface ExpiryBadgeProps {
  status: ExpiryStatus;
  className?: string;
}

/**
 * Shared expiry-status pill used by both the certification and framework
 * summary cards. Colour tokens come from the freshness palette.
 */
export function ExpiryBadge({ status, className }: ExpiryBadgeProps) {
  const config = EXPIRY_BADGE_CONFIG[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        config.textClass,
        config.bgClass,
        className,
      )}
      aria-label={`Expiry status: ${config.label}`}
    >
      {config.label}
    </span>
  );
}
