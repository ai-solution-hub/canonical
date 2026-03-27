'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, ChevronDown, ChevronUp, History } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useDisplayNames } from '@/hooks/use-display-names';
import { formatRelativeTime } from '@/components/shared/verification-badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
        .select('id, content_item_id, action_type, note, performed_by, performed_at')
        .eq('content_item_id', contentItemId)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    )
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load latest verification note:', error.message);
          return;
        }
        if (data) {
          setLatest(data as VerificationHistoryEntry);
        }
      })
      .catch((err) => {
        console.error('Failed to load latest verification note:', err);
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
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    Promise.resolve(
      supabase
        .from('verification_history')
        .select('id, content_item_id, action_type, note, performed_by, performed_at')
        .eq('content_item_id', contentItemId)
        .order('performed_at', { ascending: false }),
    )
      .then(({ data, error }) => {
        if (error) {
          console.error('Failed to load verification history:', error.message);
          setIsLoading(false);
          return;
        }
        setEntries((data as VerificationHistoryEntry[]) ?? []);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load verification history:', err);
        setIsLoading(false);
      });
  }, [contentItemId]);

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
            const performerName = displayNames.get(entry.performed_by) ?? 'Unknown user';

            return (
              <li
                key={entry.id}
                className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2"
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
