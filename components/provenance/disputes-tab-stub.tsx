'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DisputeRow {
  id: string;
  content_item_id: string;
  disputed_field: string;
  status: string;
  created_at: string;
  content_items: { title: string } | null;
}

// ---------------------------------------------------------------------------
// Status pill colours — semantic tokens only
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-[var(--color-status-warning)]/15 text-[var(--color-status-warning)]',
  resolved: 'bg-[var(--color-status-success)]/15 text-[var(--color-status-success)]',
  rejected: 'bg-muted text-muted-foreground',
};

function statusPillClass(status: string): string {
  return STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground';
}

// ---------------------------------------------------------------------------
// DisputesTabStub — labelled-interim tab ("Interim — Wave C")
// ---------------------------------------------------------------------------

export default function DisputesTabStub() {
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchDisputes() {
      try {
        const supabase = createClient();

        const result = await tryQuery<DisputeRow[]>(
          supabase
            .from('classification_disputes')
            .select(
              'id, content_item_id, disputed_field, status, created_at, content_items(title)',
            )
            .order('created_at', { ascending: false })
            .limit(50),
          'provenance.disputes_tab.fetch',
        );

        if (!result.ok) {
          logBestEffortWarn(
            'provenance.disputes_tab.fetch',
            'Failed to fetch classification disputes',
            { err: result.error.message },
          );
          setError(true);
          setLoading(false);
          return;
        }

        setDisputes(result.data ?? []);
      } catch (err) {
        logBestEffortWarn(
          'provenance.disputes_tab.fetch',
          'Failed to fetch classification disputes',
          { err: err instanceof Error ? err.message : String(err) },
        );
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchDisputes();
  }, []);

  return (
    <div className="space-y-4">
      {/* Labelled-interim banner */}
      <div
        className="rounded-lg border border-border bg-muted/50 px-4 py-3"
        data-testid="stub-label"
      >
        <p className="text-sm font-medium text-muted-foreground">
          Interim — Wave C
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          The dispute workflow ships in Wave C.
        </p>
      </div>

      {/* Disputes list */}
      <div className="rounded-lg border bg-card p-6">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="Loading disputes"
            />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Could not load disputes. Please try again later.
          </p>
        ) : disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No disputes yet. The dispute workflow ships in Wave C.
          </p>
        ) : (
          <ul className="space-y-3" role="list" aria-label="Classification disputes">
            {disputes.map((dispute) => (
              <li
                key={dispute.id}
                className="rounded-md border bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-medium text-foreground truncate">
                      {dispute.content_items?.title ?? 'Unknown item'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Disputed field:{' '}
                      <span className="font-medium">
                        {dispute.disputed_field}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                        statusPillClass(dispute.status),
                      )}
                    >
                      {dispute.status}
                    </span>
                    <time
                      className="text-xs text-muted-foreground"
                      dateTime={dispute.created_at}
                    >
                      {new Date(dispute.created_at).toLocaleDateString('en-GB', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </time>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
