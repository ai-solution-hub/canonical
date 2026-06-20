'use client';

import { Archive, SearchX, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Distinct list-surface states for `/reference` (PRODUCT.md B-18, B-19, B-20).
 *
 * Three deliberately-separate surfaces so a transport error is never mistaken
 * for an empty corpus, and a no-match search/filter is never mistaken for a
 * genuinely empty corpus:
 *  - {@link ReferenceLoadingSkeleton} — initial load / mode change (B-19).
 *  - {@link ReferenceEmptyState} — corpus-empty vs no-match (B-18).
 *  - {@link ReferenceErrorState} — non-destructive error + retry (B-20).
 *
 * Warm Meridian semantic tokens only (B-26).
 */

export function ReferenceLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading references"
      className="grid gap-4"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
    >
      <span className="sr-only">Loading references...</span>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3"
          style={{ borderLeftWidth: '4px', borderLeftColor: 'var(--border)' }}
        >
          <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-accent" />
          <div className="h-3 w-full animate-pulse rounded bg-accent" />
          <div className="mt-1 flex items-center gap-2 pt-1">
            <div className="h-3 w-20 animate-pulse rounded bg-accent" />
            <div className="h-3 w-16 animate-pulse rounded bg-accent" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Empty state — two distinct messages (B-18):
 *  - corpus-empty (`hasActiveQueryOrFilters === false`): there are no
 *    references yet at all.
 *  - no-match (`hasActiveQueryOrFilters === true`): the corpus is non-empty but
 *    nothing matched the active search/filters; offers a clear affordance.
 */
export function ReferenceEmptyState({
  hasActiveQueryOrFilters,
  onClearAll,
}: {
  hasActiveQueryOrFilters: boolean;
  onClearAll: () => void;
}) {
  if (!hasActiveQueryOrFilters) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
        <Archive
          className="size-10 text-muted-foreground/50"
          aria-hidden="true"
        />
        <h3 className="mt-4 text-base font-medium text-foreground">
          No references yet
        </h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          References imported from URLs or RSS feeds will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
      <SearchX
        className="size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h3 className="mt-4 text-base font-medium text-foreground">
        No references match
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Nothing matched your search or filters. Try clearing them to see the
        full set of references.
      </p>
      <Button variant="outline" size="sm" onClick={onClearAll} className="mt-4">
        Clear search and filters
      </Button>
    </div>
  );
}

/**
 * Error state — non-destructive, distinct from the empty state, with a retry
 * affordance (B-20). Never rendered in place of an empty corpus.
 */
export function ReferenceErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-destructive/50 bg-destructive/10 py-16 text-center"
    >
      <AlertCircle className="size-10 text-destructive/70" aria-hidden="true" />
      <h3 className="mt-4 text-base font-medium text-foreground">
        Couldn&apos;t load references
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Something went wrong while loading references. This is usually
        temporary.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
        Try again
      </Button>
    </div>
  );
}
