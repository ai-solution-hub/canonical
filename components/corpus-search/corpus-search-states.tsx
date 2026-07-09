'use client';

import { Search, SearchX, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Corpus-search-specific list-surface states (ID-135 {135.9}).
 *
 * The loading state reuses `ReferenceLoadingSkeleton`
 * (`@/components/reference/reference-states`) directly — TECH §3 BI-17
 * mandates the direct import, no divergence. These three states diverge
 * from their `reference-states.tsx` counterparts because the underlying
 * semantics differ, not merely the wording:
 *
 *  - {@link CorpusNoQueryState} — corpus search has NO browse-all mode
 *    (`useCorpusSearch` never fetches without `?q`, {135.6}), so the
 *    no-query state means "you haven't searched yet", never "the corpus is
 *    empty" (BI-8). Reusing `ReferenceEmptyState(hasActiveQueryOrFilters =
 *    false)` would render "No references yet" — the wrong semantic here,
 *    since the corpus is not empty.
 *  - {@link CorpusNoResultsState} — "No references match" is
 *    reference-only wording; it doesn't fit a corpus spanning
 *    answers/documents/references (BI-18).
 *  - {@link CorpusErrorState} — "Couldn't load references" is
 *    reference-only wording. The retry re-issues the identical `?q`/kind/
 *    filter set by reloading the current URL (BI-19) — no raw
 *    error/stack/model/score is ever rendered.
 *
 * Warm Meridian semantic tokens only (BI-4).
 *
 * Spec: TECH §3 BI-8, BI-18, BI-19; PRODUCT.md BI-8, BI-18, BI-19.
 */

/** BI-8 — guidance shown when there is no active `?q`. Not empty, not error. */
export function CorpusNoQueryState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
      <Search className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <h3 className="mt-4 text-base font-medium text-foreground">
        Start your search
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Enter a search term above to find answers, documents and references.
      </p>
    </div>
  );
}

/**
 * BI-18 — a non-empty corpus with nothing matching the active search/kind/
 * filters. Distinct from {@link CorpusNoQueryState} (no search has been
 * attempted) and from the error state (a genuine transport/RPC failure).
 */
export function CorpusNoResultsState({
  onClearAll,
}: {
  onClearAll: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
      <SearchX
        className="size-10 text-muted-foreground/50"
        aria-hidden="true"
      />
      <h3 className="mt-4 text-base font-medium text-foreground">
        No results match
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Nothing matched your search. Try broadening your search or clearing the
        kind and metadata filters.
      </p>
      <Button variant="outline" size="sm" onClick={onClearAll} className="mt-4">
        Clear search and filters
      </Button>
    </div>
  );
}

/**
 * BI-19 — non-technical failure state with a retry. `onRetry` MUST re-issue
 * the identical active `?q`/kind/filter set; callers satisfy this by
 * reloading the current URL (mirrors `ReferenceErrorState`'s retry, which
 * does the same) rather than clearing any state.
 */
export function CorpusErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-lg border border-destructive/50 bg-destructive/10 py-16 text-center"
    >
      <AlertCircle className="size-10 text-destructive/70" aria-hidden="true" />
      <h3 className="mt-4 text-base font-medium text-foreground">
        Couldn&apos;t load results
      </h3>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        Something went wrong while searching the corpus. This is usually
        temporary.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
        Try again
      </Button>
    </div>
  );
}
