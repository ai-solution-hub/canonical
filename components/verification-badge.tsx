import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerificationBadgeProps {
  verified: boolean;
  className?: string;
  /** Badge size: 'sm' for inline use, 'md' for standalone */
  size?: 'sm' | 'md';
  /** Show text label alongside icon (always shown for WCAG; colour is never the only indicator) */
  showLabel?: boolean;
}

/**
 * WCAG 2.1 AA compliant verification badge.
 * Shows icon + text label (never colour alone for meaning).
 */
export function VerificationBadge({
  verified,
  className,
  size = 'sm',
  showLabel = true,
}: VerificationBadgeProps) {
  const iconSize = size === 'sm' ? 'size-3' : 'size-3.5';

  if (verified) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-[var(--color-status-success)]',
          size === 'sm' ? 'text-xs' : 'text-xs',
          className,
        )}
        role="status"
      >
        <ShieldCheck className={cn(iconSize, 'shrink-0')} aria-hidden="true" />
        {showLabel && <span className="font-medium">Verified</span>}
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-muted-foreground',
        size === 'sm' ? 'text-xs' : 'text-xs',
        className,
      )}
      role="status"
    >
      <ShieldAlert className={cn(iconSize, 'shrink-0')} aria-hidden="true" />
      {showLabel && <span className="font-medium">Unverified</span>}
    </span>
  );
}
