'use client';

import { useState, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import PipelineHealthFilters from './pipeline-health-filters';
import PipelineRunsList from './pipeline-runs-list';
import PipelineRollupCard from './pipeline-rollup-card';
import PipelineFailureDrawer from './pipeline-failure-drawer';
import type { PipelineRunDetail } from './pipeline-failure-drawer';
import type { PipelineRollupEntry } from '@/app/api/admin/provenance/pipeline-runs/route';

// ──────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────

interface PipelineRunsPage {
  rows: PipelineRunDetail[];
  rollup: PipelineRollupEntry[];
  hasMore: boolean;
  nextCursor: { started_at: string; id: string } | null;
  window: { range: string; since: string };
  warnings?: string[];
}

async function fetchPipelineRuns(params: {
  range: string;
  kinds?: string;
  cursor_started_at?: string;
  cursor_id?: string;
}): Promise<PipelineRunsPage> {
  const query = new URLSearchParams();
  query.set('range', params.range);
  if (params.kinds) query.set('kinds', params.kinds);
  if (params.cursor_started_at)
    query.set('cursor_started_at', params.cursor_started_at);
  if (params.cursor_id) query.set('cursor_id', params.cursor_id);

  const res = await fetch(
    `/api/admin/provenance/pipeline-runs?${query.toString()}`,
  );
  if (!res.ok) {
    throw new Error(`Pipeline runs request failed (${res.status})`);
  }
  return res.json() as Promise<PipelineRunsPage>;
}

// ──────────────────────────────────────────
// Stable defaults
// ──────────────────────────────────────────

const EMPTY_KINDS: readonly string[] = [];

// ──────────────────────────────────────────
// Inner component (uses useSearchParams)
// ──────────────────────────────────────────

function PipelineHealthTabInner() {
  const searchParams = useSearchParams();
  const range = searchParams.get('range') || '24h';
  const kindsRaw = searchParams.get('kinds') || '';
  const kinds = useMemo(
    () => (kindsRaw ? kindsRaw.split(',').filter(Boolean) : EMPTY_KINDS),
    [kindsRaw],
  );

  const [selectedRun, setSelectedRun] = useState<PipelineRunDetail | null>(
    null,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleSelectRun = useCallback((run: PipelineRunDetail) => {
    setSelectedRun(run);
    setDrawerOpen(true);
  }, []);

  const handleDrawerChange = useCallback((open: boolean) => {
    setDrawerOpen(open);
    if (!open) setSelectedRun(null);
  }, []);

  const queryKey = queryKeys.admin.provenance.pipelineRuns({
    range,
    kinds,
  });

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      fetchPipelineRuns({
        range,
        kinds: kinds.length > 0 ? kinds.join(',') : undefined,
        cursor_started_at: pageParam?.started_at,
        cursor_id: pageParam?.id,
      }),
    initialPageParam: undefined as
      | { started_at: string; id: string }
      | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Flatten pages into a single rows array
  const allRows = useMemo(
    () => data?.pages.flatMap((p) => p.rows) ?? [],
    [data?.pages],
  );

  // Rollup comes from the first page (full window, no pagination)
  const rollup = useMemo(
    () => data?.pages[0]?.rollup ?? [],
    [data?.pages],
  );

  // Available kinds for the filter — derive from rollup
  const availableKinds = useMemo(
    () => rollup.map((r) => r.pipelineName),
    [rollup],
  );

  // Warnings from any page
  const warnings = useMemo(
    () => data?.pages.flatMap((p) => p.warnings ?? []) ?? [],
    [data?.pages],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-lg bg-muted"
            />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-6 text-center">
        <p className="text-destructive">
          Failed to load pipeline runs
          {error instanceof Error ? `: ${error.message}` : ''}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Warnings banner */}
      {warnings.length > 0 && (
        <div className="rounded-md border border-warning/50 bg-warning/5 p-3">
          {warnings.map((w, i) => (
            <p key={i} className="text-xs text-warning">
              {w}
            </p>
          ))}
        </div>
      )}

      {/* Filters */}
      <PipelineHealthFilters availableKinds={availableKinds} />

      {/* Rollup cards */}
      {rollup.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rollup.map((entry) => (
            <PipelineRollupCard key={entry.pipelineName} entry={entry} />
          ))}
        </div>
      )}

      {/* Runs list */}
      <PipelineRunsList
        rows={allRows as PipelineRunDetail[]}
        onSelectRun={handleSelectRun}
      />

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="rounded-md border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}

      {/* Failure drawer */}
      <PipelineFailureDrawer
        run={selectedRun}
        open={drawerOpen}
        onOpenChange={handleDrawerChange}
      />
    </div>
  );
}

// ──────────────────────────────────────────
// Exported wrapper with Suspense boundary
// ──────────────────────────────────────────

export default function PipelineHealthTab() {
  return (
    <Suspense
      fallback={
        <div className="h-64 animate-pulse rounded-lg bg-muted" />
      }
    >
      <PipelineHealthTabInner />
    </Suspense>
  );
}
