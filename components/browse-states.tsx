'use client';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBrowseFilters } from '@/hooks/use-browse-filters';
import type { ViewMode } from '@/components/filter-bar';

export function LoadingSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'list') {
    return (
      <div className="rounded-lg border border-border">
        {Array.from({ length: 10 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-border px-4"
            style={{ height: '64px' }}
          >
            <Skeleton className="size-10 shrink-0 rounded" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
            <Skeleton className="h-3 w-16 shrink-0" />
          </div>
        ))}
      </div>
    );
  }

  // Mixed skeleton: alternate between compact cards (no thumbnail) and full cards (with thumbnail)
  // to better reflect the actual mixed grid layout with Q&A pairs and articles
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {Array.from({ length: 12 }).map((_, i) => {
        // Alternate: indices 0,1,3,4,6,7 are compact, 2,5,8,11 are full
        const isCompact = i % 3 !== 2;

        if (isCompact) {
          return (
            <div
              key={i}
              className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3"
              style={{ borderLeftWidth: '4px', borderLeftColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-1.5">
                <Skeleton className="size-5 rounded" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <div className="mt-auto flex items-center gap-2 pt-1">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          );
        }

        return (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
            style={{ borderLeftWidth: '4px', borderLeftColor: 'var(--border)' }}
          >
            <Skeleton className="aspect-video w-full rounded-md" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        );
      })}
    </div>
  );
}

export function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  const { clearFilters } = useBrowseFilters();

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16">
      <p className="text-sm text-muted-foreground">
        {hasFilters
          ? 'No items match your current filters.'
          : 'No content items found.'}
      </p>
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          className="mt-3"
        >
          Clear all filters
        </Button>
      )}
    </div>
  );
}
