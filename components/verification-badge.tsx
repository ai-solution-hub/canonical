import { ShieldCheck, ShieldAlert, ShieldEllipsis } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data needed to compute trust level (editor/admin only) */
export interface TrustData {
  brief?: string | null;
  detail?: string | null;
  content_owner_id?: string | null;
}

/** Trust levels: 1 = Unverified, 2 = Verified, 3 = Curated */
export type TrustLevel = 1 | 2 | 3;

/**
 * Compute the trust level for a content item.
 *
 * - Level 1 "Unverified": no human has reviewed
 * - Level 2 "Verified": verified_at is set
 * - Level 3 "Curated": verified + has brief + has detail + has content_owner_id
 */
export function getTrustLevel(
  verified: boolean,
  trustData?: TrustData | null,
): TrustLevel {
  if (!verified) return 1;
  if (
    trustData &&
    trustData.brief &&
    trustData.detail &&
    trustData.content_owner_id
  ) {
    return 3;
  }
  return 2;
}

const TRUST_LABELS: Record<TrustLevel, string> = {
  1: 'Unverified',
  2: 'Verified',
  3: 'Curated',
};

interface VerificationBadgeProps {
  verified: boolean;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  /** Item data for trust level computation (editor/admin only) */
  trustData?: TrustData | null;
  /** Whether user can see detailed trust levels */
  showDetailedTrust?: boolean;
  className?: string;
  /** Badge size: 'sm' for inline use, 'md' for standalone */
  size?: 'sm' | 'md';
  /** Show text label alongside icon (always shown for WCAG; colour is never the only indicator) */
  showLabel?: boolean;
  /** Show name in tooltip only (for compact list items) */
  tooltipOnly?: boolean;
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
  if (minutes > 0) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  return 'just now';
}

/**
 * Build the display label text for the badge.
 */
function buildLabel(
  trustLevel: TrustLevel,
  showDetailedTrust: boolean,
  verifiedByName?: string | null,
  verifiedAt?: string | null,
): string {
  // Coalesce curated to verified for non-detailed views
  const displayLevel =
    !showDetailedTrust && trustLevel === 3 ? 2 : trustLevel;
  const base = TRUST_LABELS[displayLevel];

  if (displayLevel === 1) return base;

  // Add "by {name}" and/or relative time if available
  if (verifiedByName && verifiedAt) {
    return `${base} by ${verifiedByName}, ${formatRelativeTime(verifiedAt)}`;
  }
  if (verifiedByName) {
    return `${base} by ${verifiedByName}`;
  }
  if (verifiedAt) {
    return `${base} ${formatRelativeTime(verifiedAt)}`;
  }

  return base;
}

/**
 * WCAG 2.1 AA compliant verification badge with progressive trust levels.
 * Shows icon + text label (never colour alone for meaning).
 *
 * Backwards compatible — works with just the `verified` boolean.
 */
export function VerificationBadge({
  verified,
  verifiedAt,
  verifiedByName,
  trustData,
  showDetailedTrust = false,
  className,
  size = 'sm',
  showLabel = true,
  tooltipOnly = false,
}: VerificationBadgeProps) {
  const iconSize = size === 'sm' ? 'size-3' : 'size-3.5';
  const trustLevel = getTrustLevel(verified, trustData);

  // Coalesce curated to verified for non-detailed views
  const displayLevel =
    !showDetailedTrust && trustLevel === 3 ? 2 : trustLevel;

  const fullLabel = buildLabel(
    trustLevel,
    showDetailedTrust,
    verifiedByName,
    verifiedAt,
  );

  // Short label for display (trust level name only)
  const shortLabel = TRUST_LABELS[displayLevel];

  // Decide what text to show inline vs in tooltip
  const inlineText = tooltipOnly ? shortLabel : fullLabel;
  const tooltipText = tooltipOnly && fullLabel !== shortLabel ? fullLabel : undefined;

  if (displayLevel === 1) {
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

  // Curated uses a distinct icon
  const Icon = displayLevel === 3 ? ShieldEllipsis : ShieldCheck;
  const colourClass =
    displayLevel === 3
      ? 'text-[var(--color-status-info)]'
      : 'text-[var(--color-status-success)]';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        colourClass,
        size === 'sm' ? 'text-xs' : 'text-xs',
        className,
      )}
      role="status"
      title={tooltipText}
    >
      <Icon className={cn(iconSize, 'shrink-0')} aria-hidden="true" />
      {showLabel && <span className="font-medium">{inlineText}</span>}
    </span>
  );
}
