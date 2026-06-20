'use client';

import { useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ReferenceCard } from '@/components/reference/reference-card';
import {
  ReferenceLoadingSkeleton,
  ReferenceEmptyState,
  ReferenceErrorState,
} from '@/components/reference/reference-states';
import {
  useReferenceData,
  type ReferenceFilters,
} from '@/hooks/reference/use-reference-data';
import type { ReferenceIngestionSource } from '@/types/reference';

/**
 * `/reference` browse + search + filters surface (ID-111.10).
 *
 * A purpose-fit, MUCH thinner echo of the content_items browse stack: a default
 * `published_at DESC` list over the `reference_list` RPC, a search box over the
 * {111.9} reference-scoped endpoint, and the reduced reference filter set
 * (domain / subtopic / ingestion_source / published_at range) — all pushed
 * server-side into `reference_list` params (B-31). No presets / bulk / read-mark
 * / entity / quality / workspace machinery.
 *
 * References-only, authenticated (NOT in proxy.ts publicRoutes, B-21), lives
 * under `/reference` (never /browse or /intelligence, B-22). One `ReferenceCard`
 * shape serves both list and search rows. Warm Meridian tokens, UK English,
 * WCAG 2.1 AA (B-26).
 *
 * Spec: PRODUCT.md B-11..B-22, B-26, B-27; TECH.md Seam 1.
 */

const INGESTION_SOURCE_OPTIONS: {
  value: ReferenceIngestionSource;
  label: string;
}[] = [
  { value: 'url_import', label: 'URL import' },
  { value: 'rss_feed', label: 'RSS feed' },
];

export function ReferenceContent() {
  const {
    items,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    isSearchMode,
    error,
    searchQuery,
    filters,
    activeFilterCount,
    hasActiveQueryOrFilters,
    setSearchQuery,
    setFilters,
    clearAll,
  } = useReferenceData();

  // Live region for screen-reader result-count announcements (a11y).
  const liveRef = useRef<HTMLDivElement>(null);

  return (
    <section
      aria-label={
        isSearchMode ? 'Reference search results' : 'Browse references'
      }
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">References</h1>
        <p className="text-sm text-muted-foreground">
          External evidence imported from URLs and RSS feeds.
        </p>
      </header>

      {/* Search box (B-13/B-15). Keyed on the URL query so a back/forward
          navigation remounts it with the fresh value — no setState-in-effect
          (components/CLAUDE.md key-reset rule). */}
      <ReferenceSearchBox
        key={searchQuery ?? ''}
        initialQuery={searchQuery ?? ''}
        isSearchMode={isSearchMode}
        onSearch={(q) => setSearchQuery(q ? q : undefined)}
        onClear={() => setSearchQuery(undefined)}
      />

      {/* Filters (B-16/B-17) — reduced, reference-appropriate set only */}
      <ReferenceFilterControls
        filters={filters}
        activeFilterCount={activeFilterCount}
        onChange={setFilters}
        onClearAll={clearAll}
      />

      {/* Screen-reader result announcement */}
      <div ref={liveRef} className="sr-only" aria-live="polite" role="status">
        {!isLoading && !error
          ? `${items.length} reference${items.length !== 1 ? 's' : ''}${
              isSearchMode ? ` for ${searchQuery}` : ''
            }`
          : ''}
      </div>

      <div className="mt-6">
        {error ? (
          // Error is DISTINCT from empty (B-20) — never an empty list as if the
          // corpus were genuinely empty. Retry re-runs the active mode's fetch.
          <ReferenceErrorState onRetry={() => window.location.reload()} />
        ) : isLoading ? (
          <ReferenceLoadingSkeleton />
        ) : items.length === 0 ? (
          <ReferenceEmptyState
            hasActiveQueryOrFilters={hasActiveQueryOrFilters}
            onClearAll={clearAll}
          />
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            }}
          >
            {items.map((reference) => (
              <ReferenceCard
                key={reference.reference_id}
                reference={reference}
              />
            ))}
          </div>
        )}
      </div>

      {/* Load-more (B-19) — list mode only; search returns a ranked top-N */}
      {!isLoading && !error && items.length > 0 && (
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
            {isSearchMode
              ? `Showing top ${items.length} result${items.length !== 1 ? 's' : ''}`
              : `Showing ${items.length} reference${items.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Search box (B-13/B-15). Owns its own local input state and commits to the URL
 * on submit. Remounted via a `key` on the URL query in the parent, so a
 * back/forward navigation resets the field to the URL value without a
 * setState-in-effect (components/CLAUDE.md key-reset rule).
 */
function ReferenceSearchBox({
  initialQuery,
  isSearchMode,
  onSearch,
  onClear,
}: {
  initialQuery: string;
  isSearchMode: boolean;
  onSearch: (query: string) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState(initialQuery);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value.trim());
      }}
      className="mt-4"
      role="search"
    >
      <label htmlFor="reference-search" className="sr-only">
        Search references
      </label>
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="reference-search"
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search references..."
            className="pl-9"
          />
        </div>
        <Button type="submit" variant="default" size="sm">
          Search
        </Button>
        {isSearchMode && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X className="size-4" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * The reduced reference filter controls (B-16/B-17). Native labelled controls
 * (text labels, not colour-only — WCAG AA) writing each value straight to the
 * URL via `onChange` (server-side pushdown into `reference_list`). Deliberately
 * minimal — no taxonomy-context coupling, since the reference corpus domains are
 * free-form `text` rather than the curated content_items taxonomy.
 */
function ReferenceFilterControls({
  filters,
  activeFilterCount,
  onChange,
  onClearAll,
}: {
  filters: ReferenceFilters;
  activeFilterCount: number;
  onChange: (next: Partial<ReferenceFilters>) => void;
  onClearAll: () => void;
}) {
  const controlClass =
    'h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="reference-filter-domain"
          className="text-xs font-medium text-muted-foreground"
        >
          Domain
        </label>
        <input
          id="reference-filter-domain"
          type="text"
          value={filters.primary_domain ?? ''}
          onChange={(e) =>
            onChange({ primary_domain: e.target.value || undefined })
          }
          placeholder="Any domain"
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="reference-filter-subtopic"
          className="text-xs font-medium text-muted-foreground"
        >
          Subtopic
        </label>
        <input
          id="reference-filter-subtopic"
          type="text"
          value={filters.primary_subtopic ?? ''}
          onChange={(e) =>
            onChange({ primary_subtopic: e.target.value || undefined })
          }
          placeholder="Any subtopic"
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="reference-filter-source"
          className="text-xs font-medium text-muted-foreground"
        >
          Source
        </label>
        <select
          id="reference-filter-source"
          value={filters.ingestion_source ?? ''}
          onChange={(e) =>
            onChange({
              ingestion_source:
                (e.target.value as ReferenceIngestionSource) || undefined,
            })
          }
          className={controlClass}
        >
          <option value="">Any source</option>
          {INGESTION_SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="reference-filter-from"
          className="text-xs font-medium text-muted-foreground"
        >
          Published from
        </label>
        <input
          id="reference-filter-from"
          type="date"
          value={filters.published_from ?? ''}
          onChange={(e) =>
            onChange({ published_from: e.target.value || undefined })
          }
          className={controlClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="reference-filter-to"
          className="text-xs font-medium text-muted-foreground"
        >
          Published to
        </label>
        <input
          id="reference-filter-to"
          type="date"
          value={filters.published_to ?? ''}
          onChange={(e) =>
            onChange({ published_to: e.target.value || undefined })
          }
          className={controlClass}
        />
      </div>

      {activeFilterCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onClearAll}>
          Clear all filters
        </Button>
      )}
    </div>
  );
}
