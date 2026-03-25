'use client';

import { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, History } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateUK } from '@/lib/format';
import type { ReviewHistoryEntry } from '@/hooks/use-review-history';

/** Human-readable labels for quality flag types */
function formatFlagType(flagType: string): string {
  const labels: Record<string, string> = {
    classification_low: 'Low Classification',
    short_content: 'Short Content',
    missing_content: 'Missing Content',
    manual_review: 'Needs Review',
    duplicate_candidate: 'Possible Duplicate',
    review_needed: 'Review Needed',
    freshness_expired: 'Expired Content',
    import_warning: 'Import Warning',
    governance_review: 'Governance Review',
    needs_review: 'Needs Review',
    missing_title: 'Missing Title',
    duplicate_url: 'Duplicate URL',
  };
  return labels[flagType] ?? flagType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Get attribution text for a review entry */
function getAttribution(name: string | null): string {
  if (name) return name;
  return 'System';
}

interface ReviewHistorySectionProps {
  history: ReviewHistoryEntry[];
  isLoading?: boolean;
  className?: string;
}

/**
 * Displays a collapsible list of review history entries.
 *
 * Each entry shows the flag type, who created it, when, and any associated
 * notes or resolution details. Collapsed by default with an entry count.
 *
 * Renders nothing when the history array is empty and not loading.
 */
export function ReviewHistorySection({
  history,
  isLoading = false,
  className,
}: ReviewHistorySectionProps) {
  const [expanded, setExpanded] = useState(false);

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn('border-t border-border pt-4', className)}
        role="status"
        aria-label="Loading review history"
      >
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 animate-pulse rounded bg-accent" />
          <div className="h-4 w-32 animate-pulse rounded bg-accent" />
        </div>
      </div>
    );
  }

  // Empty state — render nothing
  if (history.length === 0) {
    return null;
  }

  return (
    <section
      className={cn('border-t border-border pt-4', className)}
      aria-label="Review history"
    >
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        aria-controls="review-history-list"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <History className="size-3.5 shrink-0" aria-hidden="true" />
        <span>Review history ({history.length})</span>
      </button>

      {/* Expandable list */}
      {expanded && (
        <ul
          id="review-history-list"
          className="mt-3 space-y-3"
          aria-label={`${history.length} review history ${history.length === 1 ? 'entry' : 'entries'}`}
        >
          {history.map((entry) => (
            <ReviewHistoryItem key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Individual review history entry */
function ReviewHistoryItem({ entry }: { entry: ReviewHistoryEntry }) {
  const flagLabel = formatFlagType(entry.flag_type);
  const createdBy = getAttribution(entry.created_by_name);
  const createdDate = formatDateUK(entry.created_at);

  const notes = entry.details?.notes || entry.details?.reason;

  return (
    <li className="flex gap-2 text-sm">
      {/* Status icon */}
      <span className="mt-0.5 shrink-0">
        {entry.resolved ? (
          <Check
            className="size-3.5 text-quality-good"
            aria-hidden="true"
          />
        ) : (
          <AlertTriangle
            className="size-3.5 text-status-warning"
            aria-hidden="true"
          />
        )}
      </span>

      {/* Entry details */}
      <div className="min-w-0 flex-1">
        {/* Primary line: flag type + attribution + date */}
        <p className="text-foreground">
          <span className="font-medium">{flagLabel}</span>
          <span className="text-muted-foreground">
            {' '}by {createdBy} on {createdDate}
          </span>
        </p>

        {/* Notes from the flag */}
        {notes && (
          <p className="mt-0.5 text-muted-foreground">
            &ldquo;{notes}&rdquo;
          </p>
        )}

        {/* Resolution details */}
        {entry.resolved && entry.resolved_at && (
          <p className="mt-0.5 text-muted-foreground">
            Resolved{entry.resolved_by_name ? ` by ${entry.resolved_by_name}` : ''} on{' '}
            {formatDateUK(entry.resolved_at)}
            {entry.resolution_notes && (
              <span>: &ldquo;{entry.resolution_notes}&rdquo;</span>
            )}
          </p>
        )}
      </div>
    </li>
  );
}
