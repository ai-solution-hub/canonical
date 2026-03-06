'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { LayoutGrid, List, RefreshCw, SearchX, Info } from 'lucide-react';
import { SearchBar } from '@/components/search-bar';
import { ContentGrid } from '@/components/content-grid';
import { ContentList } from '@/components/content-list';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useSearch } from '@/hooks/use-search';
import { useReadMarks } from '@/contexts/read-marks-context';

type ViewMode = 'grid' | 'list';

const VIEW_MODE_KEY = 'kb-search-view-mode';

function getStoredViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/** Skeleton placeholder for grid view while results load */
function GridSkeleton() {
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col overflow-hidden rounded-lg border border-border"
        >
          <Skeleton className="aspect-video w-full rounded-b-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <div className="mt-auto flex flex-col gap-1.5 pt-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Skeleton placeholder for list view while results load */
function ListSkeleton() {
  return (
    <div className="rounded-lg border border-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-border px-4 py-2 last:border-b-0"
          style={{ height: '64px' }}
        >
          <Skeleton className="size-10 shrink-0 rounded" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-3 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const { results, count, isLoading, error, search } = useSearch();
  const { readItemIds, isLoaded: readMarksLoaded, loadReadMarks, checkReadStatus } = useReadMarks();

  // Trigger lazy loading of read marks counts for this page
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  // Check read status for search results when they change
  useEffect(() => {
    if (results.length > 0) {
      checkReadStatus(results.map((r) => r.id));
    }
  }, [results, checkReadStatus]);

  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  // Initialise view mode from localStorage after mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrating client-only localStorage value after mount to avoid SSR mismatch
    setViewMode(getStoredViewMode());
  }, []);

  const handleViewChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // localStorage unavailable — ignore
    }
  }, []);

  // Trigger search when query changes
  useEffect(() => {
    if (query) {
      search(query);
    }
  }, [query, search]);

  const handleRetry = useCallback(() => {
    if (query) {
      search(query);
    }
  }, [query, search]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="sr-only">
        {query ? `Search results for \u201c${query}\u201d` : 'Search'}
      </h1>

      {/* Search bar (compact, pre-filled with query) */}
      <div className="mb-8">
        <SearchBar variant="compact" defaultValue={query} autoFocus />
      </div>

      {/* Error state */}
      {error && !isLoading && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="flex-1 text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRetry}
            className="shrink-0"
          >
            <RefreshCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div role="status" aria-label="Loading search results" aria-busy="true">
          <div className="mb-6 flex items-center justify-between">
            <Skeleton className="h-5 w-48" />
            <div className="flex items-center gap-1">
              <Skeleton className="size-9 rounded-md" />
              <Skeleton className="size-9 rounded-md" />
            </div>
          </div>
          {viewMode === 'grid' ? <GridSkeleton /> : <ListSkeleton />}
        </div>
      )}

      {/* Results */}
      {!isLoading && !error && query && (
        <>
          {/* Results header */}
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground" aria-live="polite" role="status">
                {count > 0 ? (
                  <>
                    <span className="font-medium text-foreground">{count}</span>{' '}
                    {count === 1 ? 'result' : 'results'} for{' '}
                    <span className="font-medium text-foreground">
                      &lsquo;{query}&rsquo;
                    </span>
                  </>
                ) : null}
              </p>
              {count > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Hybrid search
                      <Info className="size-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs">
                    Results ranked by a combination of AI embedding similarity
                    and keyword matching for title, author, and keywords.
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {count > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => handleViewChange('grid')}
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                >
                  <LayoutGrid className="size-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={() => handleViewChange('list')}
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                >
                  <List className="size-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Empty state */}
          {count === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <SearchX className="mx-auto mb-4 size-12 text-muted-foreground/50" />
              <h2 className="mb-2 text-lg font-medium text-foreground">
                No matches found for &lsquo;{query}&rsquo;
              </h2>
              <p className="mb-6 max-w-md text-sm text-muted-foreground mx-auto text-center">
                Try broader terms, different keywords, or browse by domain to
                explore your collection.
              </p>
              <Button variant="outline" asChild>
                <Link href="/browse">Browse by domain</Link>
              </Button>
            </div>
          )}

          {/* Result items — highlighted when query is present */}
          {count > 0 &&
            (viewMode === 'grid' ? (
              <ContentGrid
                items={results}
                readItemIds={readMarksLoaded ? readItemIds : undefined}
                highlightQuery={query}
              />
            ) : (
              <ContentList
                items={results}
                readItemIds={readMarksLoaded ? readItemIds : undefined}
                highlightQuery={query}
              />
            ))}
        </>
      )}

      {/* No query state (navigated to /search without ?q=) */}
      {!isLoading && !error && !query && (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Enter a query in the search bar above to find semantically similar
            items in your collection.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <Skeleton className="mb-8 h-9 w-full max-w-sm" />
          <Skeleton className="mb-6 h-5 w-48" />
          <GridSkeleton />
        </div>
      }
    >
      <SearchResults />
    </Suspense>
  );
}
