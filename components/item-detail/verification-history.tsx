'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  History,
  RotateCcw,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { captureClientException } from '@/lib/client-telemetry';
import { useDisplayNames } from '@/hooks/use-display-names';
import { formatRelativeTime } from '@/components/shared/verification-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @public */
export interface VerificationHistoryEntry {
  id: string;
  content_item_id: string;
  action_type: 'verify' | 'unverify' | 'flag';
  note: string | null;
  performed_by: string;
  performed_at: string;
}

interface VerificationHistoryProps {
  contentItemId: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Action type display configuration
// ---------------------------------------------------------------------------

const ACTION_CONFIG: Record<
  VerificationHistoryEntry['action_type'],
  {
    icon: typeof CheckCircle2;
    label: string;
    colourClass: string;
  }
> = {
  verify: {
    icon: CheckCircle2,
    label: 'Verified',
    colourClass: 'text-[var(--color-status-success)]',
  },
  unverify: {
    icon: XCircle,
    label: 'Unverified',
    colourClass: 'text-muted-foreground',
  },
  flag: {
    icon: AlertTriangle,
    label: 'Flagged',
    colourClass: 'text-[var(--color-status-warning)]',
  },
};

// ---------------------------------------------------------------------------
// Latest verification note (inline below badge)
// ---------------------------------------------------------------------------

export function LatestVerificationNote({
  contentItemId,
  className,
}: VerificationHistoryProps) {
  const [latest, setLatest] = useState<VerificationHistoryEntry | null>(null);

  useEffect(() => {
    const supabase = createClient();

    Promise.resolve(
      supabase
        .from('verification_history')
        .select(
          'id, content_item_id, action_type, note, performed_by, performed_at',
        )
        .eq('content_item_id', contentItemId)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    )
      .then(({ data, error }) => {
        if (error) {
          logBestEffortWarn(
            'item_detail.verification_history.latest_note',
            'Failed to load latest verification note',
            { err: error },
          );
          return;
        }
        if (data) {
          setLatest(data as VerificationHistoryEntry);
        }
      })
      .catch((err) => {
        logBestEffortWarn(
          'item_detail.verification_history.latest_note',
          'Failed to load latest verification note',
          { err },
        );
      });
  }, [contentItemId]);

  if (!latest?.note) return null;

  return (
    <p className={cn('text-xs text-muted-foreground italic', className)}>
      Note: {latest.note}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Full verification history (expandable)
// ---------------------------------------------------------------------------

export function VerificationHistory({
  contentItemId,
  className,
}: VerificationHistoryProps) {
  const [entries, setEntries] = useState<VerificationHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const fetchHistory = useCallback(() => {
    const supabase = createClient();

    Promise.resolve(
      supabase
        .from('verification_history')
        .select(
          'id, content_item_id, action_type, note, performed_by, performed_at',
        )
        .eq('content_item_id', contentItemId)
        .order('performed_at', { ascending: false }),
    )
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          captureClientException(fetchError, {
            scope: 'item-detail.verification-history.loadError',
            extras: { contentItemId },
          });
          setError(
            fetchError instanceof Error
              ? fetchError
              : new Error(String(fetchError)),
          );
          setIsLoading(false);
          return;
        }
        setEntries((data as VerificationHistoryEntry[]) ?? []);
        setIsLoading(false);
      })
      .catch((err) => {
        captureClientException(err, {
          scope: 'item-detail.verification-history.loadCatch',
          extras: { contentItemId },
        });
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      });
  }, [contentItemId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Collect all performer IDs for display name resolution
  const performerIds = entries.map((e) => e.performed_by);
  const displayNames = useDisplayNames(performerIds);

  if (isLoading) {
    return (
      <div className={cn('text-xs text-muted-foreground', className)}>
        Loading verification history...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'rounded-lg border bg-card p-4 text-sm text-muted-foreground',
          className,
        )}
      >
        <p className="mb-3">
          Couldn&apos;t load verification history. Please try again.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setIsLoading(true);
            fetchHistory();
          }}
          className="gap-1.5"
        >
          <RotateCcw className="size-3.5" aria-hidden="true" />
          Retry
        </Button>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground', className)}>
        No verification history for this item.
      </div>
    );
  }

  return (
    <div className={cn('text-sm', className)}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={isExpanded}
        aria-controls="verification-history-list"
      >
        <History className="size-3.5" aria-hidden="true" />
        Verification history ({entries.length})
        {isExpanded ? (
          <ChevronUp className="size-3" aria-hidden="true" />
        ) : (
          <ChevronDown className="size-3" aria-hidden="true" />
        )}
      </button>

      {isExpanded && (
        <ul
          id="verification-history-list"
          className="mt-2 space-y-2"
          role="list"
          aria-label="Verification history"
        >
          {entries.map((entry) => {
            const config = ACTION_CONFIG[entry.action_type];
            const Icon = config.icon;
            const performerName =
              displayNames.get(entry.performed_by) ?? 'Unknown user';

            return (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-md border bg-card px-3 py-2"
              >
                <Icon
                  className={cn('size-4 shrink-0 mt-0.5', config.colourClass)}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                    <span className={cn('font-medium', config.colourClass)}>
                      {config.label}
                    </span>
                    <span className="text-muted-foreground">
                      by {performerName}
                    </span>
                    <span className="text-muted-foreground">
                      {formatRelativeTime(entry.performed_at)}
                    </span>
                  </div>
                  {entry.note && (
                    <p className="mt-0.5 text-xs text-muted-foreground italic">
                      {entry.note}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
