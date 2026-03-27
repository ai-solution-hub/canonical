'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PriorityGapsSummary } from './priority-gaps-summary';
import {
  PriorityGapsFilters,
  type SourceFilter,
  type PriorityFilter,
} from './priority-gaps-filters';
import { PriorityGapCard } from './priority-gap-card';
import type { UnifiedGapSummary } from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function PriorityGapsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading priority gaps">
      <span className="sr-only">Loading priority gaps...</span>
      {/* Summary cards skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      {/* Filter bar skeleton */}
      <Skeleton className="h-12 rounded-lg" />
      {/* Gap card skeletons */}
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-28 rounded-lg" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function PriorityGapsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <CheckCircle
        className="size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h3 className="mt-4 text-base font-medium text-foreground">
        No content gaps detected
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Your knowledge base covers all taxonomy subtopics, template
        requirements, and guide sections.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function PriorityGapsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/30 px-6 py-16 text-center">
      <p className="text-sm text-destructive">
        Failed to load priority gaps data.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-3">
        <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

export function PriorityGapsTab() {
  const [data, setData] = useState<UnifiedGapSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showCount, setShowCount] = useState(PAGE_SIZE);

  // Filters
  const [source, setSource] = useState<SourceFilter>('all');
  const [priority, setPriority] = useState<PriorityFilter>('all');
  const [domain, setDomain] = useState<string>('all');

  // Track whether filters have changed for aria-live
  const isInitialLoadRef = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);

    try {
      const params = new URLSearchParams();
      if (source !== 'all') params.set('source', source);
      if (priority !== 'all') params.set('priority', priority);
      if (domain !== 'all') params.set('domain', domain);
      params.set('limit', '100');

      const res = await fetch(`/api/coverage/gaps?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const json: UnifiedGapSummary = await res.json();
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      isInitialLoadRef.current = false;
    }
  }, [source, priority, domain]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset show count when filters change
  useEffect(() => {
    setShowCount(PAGE_SIZE);
  }, [source, priority, domain]);

  if (loading && isInitialLoadRef.current) return <PriorityGapsSkeleton />;
  if (error) return <PriorityGapsError onRetry={fetchData} />;
  if (!data || data.total_gaps === 0) return <PriorityGapsEmpty />;

  const visibleGaps = data.gaps.slice(0, showCount);
  const hasMore = data.gaps.length > showCount;

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <PriorityGapsSummary summary={data} />

      {/* Filter bar */}
      <PriorityGapsFilters
        source={source}
        priority={priority}
        domain={domain}
        onSourceChange={setSource}
        onPriorityChange={setPriority}
        onDomainChange={setDomain}
      />

      {/* Gap list */}
      <div aria-live="polite" aria-atomic="false">
        {loading && !isInitialLoadRef.current ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-lg" />
            ))}
          </div>
        ) : data.gaps.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No gaps match the current filters.
            </p>
          </div>
        ) : (
          <>
            <ul role="list" className="space-y-3" aria-label="Priority gaps">
              {visibleGaps.map((gap) => (
                <PriorityGapCard key={gap.gap_key} gap={gap} />
              ))}
            </ul>

            {hasMore && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => setShowCount((prev) => prev + PAGE_SIZE)}
                  className="min-h-[44px]"
                >
                  Show more ({data.gaps.length - showCount} remaining)
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
