'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchEvalCostAggregate } from '@/lib/query/fetchers';

// ---------------------------------------------------------------------------
// CostTabStub — live aggregate over `ai_call_events` (ID-104 T17 / B-INV-17)
//
// Re-pointed from the interim `pipeline_runs.cost` read to a real aggregate
// over `ai_call_events` keyed by `touchpoint_id`. The "Interim — Wave B"
// banner is kept until per-touchpoint drill-down is wired in a later wave.
// ---------------------------------------------------------------------------

export default function CostTabStub() {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.eval.costAggregate,
    queryFn: fetchEvalCostAggregate,
  });

  return (
    <div className="space-y-4">
      {/* Labelled-interim banner — retained until per-touchpoint drill-down (Wave C) */}
      <div
        className="rounded-lg border border-border bg-muted/50 px-4 py-3"
        data-testid="stub-label"
      >
        <p className="text-sm font-medium text-muted-foreground">
          Interim — Wave B
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-touchpoint cost drill-down will be available in a future update.
        </p>
      </div>

      {/* Cost aggregate from ai_call_events */}
      <div className="rounded-lg border bg-card p-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="Loading cost data"
            />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">
            Could not load cost data. Please try again later.
          </p>
        ) : !data || data.totalCostUsd === null ? (
          <p className="text-sm text-muted-foreground">
            No cost data recorded yet.
          </p>
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              AI call cost
            </h3>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                ${data.totalCostUsd.toFixed(4)}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              across {data.callCount} {data.callCount === 1 ? 'call' : 'calls'}{' '}
              / {data.touchpointCount}{' '}
              {data.touchpointCount === 1 ? 'touchpoint' : 'touchpoints'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
