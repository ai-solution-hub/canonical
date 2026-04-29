'use client';

import { Pencil, Eye, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  VALID_PUBLICATION_STATUSES,
  type PublicationStatus,
} from '@/lib/governance/publication-transitions';

/**
 * Visible (non-`'published'`) subset of `PublicationStatus`. The badge auto-
 * hides on `'published'` per spec §15 R8 — rendering a chip for the typical
 * case would clutter cards already showing 5+ badges (Freshness, Governance,
 * Quality, Verification, Priority).
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §10.4 + §15 R8.
 */
type VisiblePublicationStatus = Exclude<PublicationStatus, 'published'>;

interface PublicationStatusBadgeProps {
  /**
   * Publication status from `content_items.publication_status` (DB column is
   * `string` NOT NULL with DEFAULT `'published'`). Accepts `string | null |
   * undefined` to tolerate pre-normalisation rows. Renders only when the
   * value is one of `'draft' | 'in_review' | 'archived'`.
   */
  status: string | null | undefined;
  className?: string;
}

const VARIANT_CONFIG: Record<
  VisiblePublicationStatus,
  {
    label: string;
    icon: typeof Pencil;
    chipClass: string;
  }
> = {
  draft: {
    label: 'Draft',
    icon: Pencil,
    // Muted tone — drafts are neutral / in-progress, not urgent.
    // V_W3 LOW: `border-border` tokenises identically to the card border
    // (both `oklch(0.78 0.012 48)` light / `oklch(0.3 0.014 48)` dark in
    // app/globals.css), so the chip had no visible border against the card
    // — the bordered-chip aesthetic of ReviewCadenceBadge requires a tinted
    // border. `border-muted-foreground/30` is the established Warm-Meridian
    // convention for muted chip outlines (see `bid-state-indicator.tsx`).
    chipClass: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  },
  in_review: {
    label: 'In Review',
    icon: Eye,
    // Warning/aging tone — matches ReviewCadenceBadge "due-soon" amber so
    // status urgency is consistent across the badge row.
    chipClass:
      'border-freshness-aging bg-freshness-aging-bg text-freshness-aging',
  },
  archived: {
    label: 'Archived',
    icon: Archive,
    // Expired/stale tone — uses the established freshness-expired-bg token
    // (verified present in app/globals.css under both light + dark themes).
    chipClass:
      'border-freshness-expired bg-freshness-expired-bg text-freshness-expired',
  },
};

/**
 * Type guard for the visible (non-`'published'`) statuses. Returns false for
 * `'published'`, `null`, `undefined`, and any unknown string.
 */
function isVisibleStatus(
  value: string | null | undefined,
): value is VisiblePublicationStatus {
  if (typeof value !== 'string') return false;
  if (value === 'published') return false;
  return (VALID_PUBLICATION_STATUSES as readonly string[]).includes(value);
}

/**
 * Publication-status indicator shown alongside `FreshnessBadge` and
 * `ReviewCadenceBadge` in the content card status row. Auto-hides for
 * `'published'` (the typical case) per spec §15 R8 clutter mitigation.
 *
 * WCAG 2.1 AA: combines an icon + visible text label (never colour alone).
 * Icon is decorative (`aria-hidden`); the chip carries `role="img"` and an
 * `aria-label` of the form `"Publication status: <Label>"`.
 */
export function PublicationStatusBadge({
  status,
  className,
}: PublicationStatusBadgeProps) {
  if (!isVisibleStatus(status)) return null;

  const config = VARIANT_CONFIG[status];
  const Icon = config.icon;
  const ariaLabel = `Publication status: ${config.label}`;

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium',
        config.chipClass,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}
