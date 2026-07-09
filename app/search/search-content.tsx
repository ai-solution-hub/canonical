'use client';

import { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CorpusResultCard } from '@/components/corpus-search/corpus-result-card';
import {
  CorpusSearchBox,
  CorpusKindNarrow,
  CorpusFilterControls,
} from '@/components/corpus-search/corpus-search-controls';
import {
  CorpusNoQueryState,
  CorpusNoResultsState,
  CorpusErrorState,
} from '@/components/corpus-search/corpus-search-states';
import { ReferenceLoadingSkeleton } from '@/components/reference/reference-states';
import { useCorpusSearch } from '@/hooks/corpus-search/use-corpus-search';

/**
 * `CorpusSearchContent` — `/search` client surface wiring (ID-135 {135.9},
 * Surface A).
 *
 * Wires the {135.6} `useCorpusSearch` hook, the {135.7} `CorpusResultCard`,
 * and the {135.8} search/kind-narrow/filter controls into one page body. A
 * DISTINCT surface from `/library` — it links INTO `/library`,
 * `/documents/[id]` and `/reference/[id]` (RD-1) rather than embedding a
 * `/library` mode.
 *
 * State precedence (evaluated top to bottom, TECH §3):
 *  1. No `?q` → {@link CorpusNoQueryState} guidance (BI-8) — checked FIRST so
 *     a no-query render is never mistaken for loading or an error.
 *  2. A transport/RPC error → {@link CorpusErrorState} + retry (BI-19).
 *  3. In flight → `ReferenceLoadingSkeleton` (BI-17, mandated direct import).
 *  4. Zero results → {@link CorpusNoResultsState}, distinct from no-query
 *     (BI-18).
 *  5. Results → a `CorpusResultCard` grid in the order the hook returned
 *     them (server-stable ordering, BI-11), followed by an explicit
 *     "Load more" / end-of-results indicator (BI-20).
 *
 * `CorpusSearchBox` is keyed on the current `?q` at THIS call site — the
 * control relies on the caller for remount (components/CLAUDE.md key-reset
 * rule; {135.8} note).
 *
 * The retry affordance reloads the current URL — the simplest way to
 * re-issue the identical `?q`/kind/filter set (BI-19) without requiring a
 * `refetch()` export from {135.6}'s hook, mirroring `ReferenceContent`'s
 * established retry pattern.
 *
 * Spec: TECH §3 BI-1, BI-7, BI-8, BI-9, BI-11, BI-12, BI-13, BI-14, BI-15,
 * BI-16, BI-17, BI-18, BI-19, BI-20; PRODUCT.md same invariants.
 */
export function CorpusSearchContent() {
  const {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    error,
    searchQuery,
    hasQuery,
    clearAll,
  } = useCorpusSearch();

  // Live region for screen-reader result-count announcements (a11y),
  // mirroring ReferenceContent.
  const liveRef = useRef<HTMLDivElement>(null);

  return (
    <section
      aria-label="Search the corpus"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Search</h1>
        <p className="text-sm text-muted-foreground">
          Search answers, documents and references across the corpus.
        </p>
      </header>

      {/* BI-9 — keyed on the current ?q so a back/forward navigation forces a
          clean remount (components/CLAUDE.md key-reset rule; the control
          relies on the caller for this per {135.8}). */}
      <CorpusSearchBox key={searchQuery ?? ''} />
      <CorpusKindNarrow />
      <CorpusFilterControls />

      <div ref={liveRef} className="sr-only" aria-live="polite" role="status">
        {!isLoading && !error && hasQuery
          ? `${items.length} result${items.length !== 1 ? 's' : ''} for ${searchQuery}`
          : ''}
      </div>

      <div className="mt-6">
        {!hasQuery ? (
          <CorpusNoQueryState />
        ) : error ? (
          <CorpusErrorState onRetry={() => window.location.reload()} />
        ) : isLoading ? (
          <ReferenceLoadingSkeleton />
        ) : items.length === 0 ? (
          <CorpusNoResultsState onClearAll={clearAll} />
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {items.map((result) => (
              <CorpusResultCard key={result.id} result={result} />
            ))}
          </div>
        )}
      </div>

      {/* BI-20 — incremental load + an explicit end-of-results indicator,
          distinct from the "Load more" affordance itself. */}
      {hasQuery && !isLoading && !error && items.length > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2">
          {hasMore && (
            <Button
              variant="outline"
              size="sm"
              onClick={loadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Loading...
                </>
              ) : (
                'Load more'
              )}
            </Button>
          )}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {hasMore
              ? `Showing ${items.length} result${items.length !== 1 ? 's' : ''}`
              : `End of results — ${items.length} result${items.length !== 1 ? 's' : ''} shown`}
          </p>
        </div>
      )}
    </section>
  );
}
