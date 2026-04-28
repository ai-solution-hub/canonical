'use client';

import { AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateUK } from '@/lib/format';

/**
 * Review cadence band — derived from `governance_review_status` and
 * `next_review_date`. See spec §7.2 rendering matrix.
 */
export type ReviewBand = 'overdue' | 'due-soon' | 'due-later' | 'none';

/**
 * Pure helper — given the governance status and next-review date, return the
 * rendering band. Exported for unit-test boundary coverage.
 *
 * Precedence: `governance_review_status === 'review_overdue'` always takes
 * precedence over the date-based bands.
 *
 * Boundary inclusivity (per spec §7.2 / T1-AC2/3):
 *   - `=== 14` days falls into `due-soon` (amber).
 *   - `=== 30` days falls into `due-later` (muted).
 *   - `> 30` days OR null → `none`.
 *
 * Negative day-deltas (i.e. the date has already passed) without an
 * `'review_overdue'` status fall into `due-soon`. This is rare in practice —
 * the cron transitions items to `'review_overdue'` once the date passes — but
 * the UI should still surface the urgency rather than hide it.
 */
export function calculateReviewBand({
  nextReviewDate,
  governanceStatus,
  now = new Date(),
}: {
  nextReviewDate: string | null | undefined;
  governanceStatus: string | null | undefined;
  now?: Date;
}): ReviewBand {
  if (governanceStatus === 'review_overdue') return 'overdue';
  if (!nextReviewDate) return 'none';

  // Compute calendar-day delta (UTC midnight comparison) so a same-date
  // value is === 0, not affected by the time component of `now`.
  const target = new Date(nextReviewDate);
  if (Number.isNaN(target.getTime())) return 'none';

  const targetUTC = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  const nowUTC = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const dayDelta = Math.round((targetUTC - nowUTC) / (1000 * 60 * 60 * 24));

  if (dayDelta <= 14) return 'due-soon';
  if (dayDelta <= 30) return 'due-later';
  return 'none';
}

interface ReviewCadenceBadgeProps {
  /** ISO date string (DATE column) — null/undefined means no badge. */
  nextReviewDate: string | null | undefined;
  /** Governance review status — `'review_overdue'` triggers the red badge. */
  governanceStatus: string | null | undefined;
  /** Optional override for testability. Defaults to `new Date()`. */
  now?: Date;
  className?: string;
}

/**
 * Review-cadence indicator shown alongside `GovernanceBadge` in the content
 * card status row. Rendering matrix in spec §7.2.
 *
 * WCAG 2.1 AA: text label is always present (never colour alone). Icon is
 * decorative (`aria-hidden`).
 */
export function ReviewCadenceBadge({
  nextReviewDate,
  governanceStatus,
  now,
  className,
}: ReviewCadenceBadgeProps) {
  const band = calculateReviewBand({
    nextReviewDate,
    governanceStatus,
    now,
  });

  if (band === 'none') return null;

  if (band === 'overdue') {
    return (
      <span
        role="img"
        aria-label="Review overdue"
        className={cn(
          'inline-flex items-center gap-1 rounded border border-bid-overdue-border bg-bid-overdue-bg px-1.5 py-0.5 text-[10px] font-medium text-bid-overdue',
          className,
        )}
      >
        <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
        <span>Review overdue</span>
      </span>
    );
  }

  // Date-based bands always render the formatted date — `band !== 'overdue'`
  // implies `nextReviewDate` is a parseable ISO string (calculateReviewBand
  // returns 'none' otherwise).
  const dateLabel = formatDateUK(nextReviewDate ?? null);
  const text = `Review due ${dateLabel}`;

  if (band === 'due-soon') {
    return (
      <span
        role="img"
        aria-label={text}
        className={cn(
          'inline-flex items-center gap-1 rounded border border-freshness-aging-bg bg-freshness-aging-bg px-1.5 py-0.5 text-[10px] font-medium text-freshness-aging',
          className,
        )}
      >
        <Clock className="size-3 shrink-0" aria-hidden="true" />
        <span>{text}</span>
      </span>
    );
  }

  // band === 'due-later' — muted variant
  return (
    <span
      role="img"
      aria-label={text}
      className={cn(
        'inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground',
        className,
      )}
    >
      <Clock className="size-3 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}
