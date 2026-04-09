import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VerificationBadgeProps {
  verified: boolean;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  className?: string;
  /** Badge size: 'sm' for inline use, 'md' for standalone */
  size?: 'sm' | 'md';
  /** Show text label alongside icon (always shown for WCAG; colour is never the only indicator) */
  showLabel?: boolean;
  /** When true, use role="status" (ARIA live region). Default false.
   *  Only set to true for single page-level badges (e.g. ItemTitleSection). */
  liveRegion?: boolean;
}

/**
 * Format a relative time string like "3 days ago", "2 hours ago" etc.
 */
export function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (months > 0) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  if (weeks > 0) return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  if (hours > 0) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  if (minutes > 0)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  return 'just now';
}

/**
 * WCAG 2.1 AA compliant binary verification badge.
 * Shows icon + text label (never colour alone for meaning).
 *
 * Binary model: `Unverified` / `Verified`. The former three-tier `Curated`
 * level was retired in S157 WP4 — curation-completeness signals (brief +
 * detail + content owner) now live in the editor-only
 * `ItemCompletenessChecklist` sidebar on the item detail page.
 */
export function VerificationBadge({
  verified,
  verifiedAt,
  verifiedByName,
  className,
  size = 'sm',
  showLabel = true,
  liveRegion = false,
}: VerificationBadgeProps) {
  const iconSize = size === 'sm' ? 'size-3' : 'size-3.5';

  if (!verified) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-muted-foreground text-xs',
          className,
        )}
        role={liveRegion ? 'status' : 'img'}
        aria-label={liveRegion ? undefined : 'Unverified'}
      >
        <ShieldAlert className={cn(iconSize, 'shrink-0')} aria-hidden="true" />
        {showLabel && <span className="font-medium">Unverified</span>}
      </span>
    );
  }

  let label = 'Verified';
  if (verifiedByName && verifiedAt) {
    label = `Verified by ${verifiedByName}, ${formatRelativeTime(verifiedAt)}`;
  } else if (verifiedByName) {
    label = `Verified by ${verifiedByName}`;
  } else if (verifiedAt) {
    label = `Verified ${formatRelativeTime(verifiedAt)}`;
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-[var(--color-status-success)]',
        className,
      )}
      role={liveRegion ? 'status' : 'img'}
      aria-label={liveRegion ? undefined : label}
    >
      <ShieldCheck className={cn(iconSize, 'shrink-0')} aria-hidden="true" />
      {showLabel && <span className="font-medium">{label}</span>}
    </span>
  );
}
