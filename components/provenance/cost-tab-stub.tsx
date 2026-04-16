'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CostAggregate {
  totalCost: number | null;
  runCount: number;
}

// ---------------------------------------------------------------------------
// CostTabStub — labelled-interim tab ("Interim — Wave B")
// ---------------------------------------------------------------------------

export default function CostTabStub() {
  const [data, setData] = useState<CostAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchCostAggregate() {
      try {
        const supabase = createClient();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { data: rows, error: queryError } = await supabase
          .from('pipeline_runs')
          .select('cost')
          .gte('started_at', thirtyDaysAgo.toISOString());

        if (queryError) {
          logBestEffortWarn(
            'provenance.cost_tab.fetch',
            'Failed to fetch pipeline cost aggregate',
            { err: queryError.message },
          );
          setError(true);
          setLoading(false);
          return;
        }

        const costs = (rows ?? [])
          .map((r) => r.cost)
          .filter((c): c is number => c !== null);

        setData({
          totalCost: costs.length > 0
            ? costs.reduce((sum, c) => sum + c, 0)
            : null,
          runCount: (rows ?? []).length,
        });
      } catch (err) {
        logBestEffortWarn(
          'provenance.cost_tab.fetch',
          'Failed to fetch pipeline cost aggregate',
          { err: err instanceof Error ? err.message : String(err) },
        );
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchCostAggregate();
  }, []);

  return (
    <div className="space-y-4">
      {/* Labelled-interim banner */}
      <div
        className="rounded-lg border border-border bg-muted/50 px-4 py-3"
        data-testid="stub-label"
      >
        <p className="text-sm font-medium text-muted-foreground">
          Interim — Wave B
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-touchpoint cost tracking will be available in a future update.
        </p>
      </div>

      {/* Cost aggregate */}
      <div className="rounded-lg border bg-card p-6">
        {loading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2
              className="size-5 animate-spin text-muted-foreground"
              aria-label="Loading cost data"
            />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Could not load cost data. Please try again later.
          </p>
        ) : !data || data.totalCost === null ? (
          <p className="text-sm text-muted-foreground">
            No cost data recorded in the last 30 days.
          </p>
        ) : (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              Last 30 days
            </h3>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-foreground">
                ${data.totalCost.toFixed(4)}
              </span>
              <span className="text-sm text-muted-foreground">
                across {data.runCount} pipeline {data.runCount === 1 ? 'run' : 'runs'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
