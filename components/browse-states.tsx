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

  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3"
        >
          <Skeleton className="aspect-video w-full rounded-md" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
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
