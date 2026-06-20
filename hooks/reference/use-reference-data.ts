'use client';

import { useCallback, useMemo } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
} from '@tanstack/react-query';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, ApiError } from '@/lib/query/fetchers';
import type {
  ReferenceListItem,
  ReferenceIngestionSource,
} from '@/types/reference';
import type { Database } from '@/supabase/types/database.types';

/**
 * The generated `reference_list` RPC return row (11 non-null columns). The
 * `reference_search` RPC returns these same columns plus the two score fields,
 * so {@link RawReferenceRow} extends this with the optional scores.
 */
type ReferenceListRpcRow =
  Database['public']['Functions']['reference_list']['Returns'][number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 48;
const SEARCH_RESULT_LIMIT = 50;
const LIST_STALE_TIME = 30_000;
const SEARCH_STALE_TIME = 60_000;

/**
 * Stable empty default so list-mode and search-mode returns never hand a fresh
 * `[]` reference to consumers (components/CLAUDE.md stable-empty rule — inline
 * `?? []` busts downstream memo deps every render).
 */
const EMPTY_ITEMS: ReferenceListItem[] = [];

// ---------------------------------------------------------------------------
// Filter model — the reduced, reference-appropriate set (PRODUCT.md B-16).
//
// ONLY: primary_domain, primary_subtopic, ingestion_source, published_at range.
// No workspace/entity/content_type/platform/author/freshness/quality/owner/
// governance/starred/tags/preset dimensions (B-16 Non-goals).
// ---------------------------------------------------------------------------

/** @public */
export interface ReferenceFilters {
  primary_domain?: string;
  primary_subtopic?: string;
  ingestion_source?: ReferenceIngestionSource;
  /** Inclusive lower bound on `published_at` (ISO date, e.g. `2026-01-01`). */
  published_from?: string;
  /** Inclusive upper bound on `published_at` (ISO date). */
  published_to?: string;
}

/** A single page of list results returned by the infinite query's queryFn. */
interface ReferenceListPage {
  items: ReferenceListItem[];
  /** Offset for the NEXT page, or `null` when the last page is short. */
  nextOffset: number | null;
}

/** @public */
export interface UseReferenceDataReturn {
  items: ReferenceListItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /** True when the row set is search results rather than the default list. */
  isSearchMode: boolean;
  /** A transport/RPC error from the active mode (list OR search), else null. */
  error: string | null;
  /** Current free-text query from `?q=`, or undefined in default-list mode. */
  searchQuery: string | undefined;
  /** Current filter set parsed from the URL. */
  filters: ReferenceFilters;
  /** Count of active filters (each filled filter slot counts once). */
  activeFilterCount: number;
  /** True when a search query OR any filter is active. */
  hasActiveQueryOrFilters: boolean;
  setSearchQuery: (query: string | undefined) => void;
  setFilters: (next: Partial<ReferenceFilters>) => void;
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Pure helper: narrow a raw reference_list / reference_search RPC row into the
// shared ReferenceListItem. The generated RPC Returns type widens
// `ingestion_source` to `string`; we restore the CHECK-constrained union at the
// read boundary (mirrors the detail-page narrowing in `types/reference.ts`).
// ---------------------------------------------------------------------------

/**
 * Raw RPC row — the structural shape returned by both `reference_list` and
 * `reference_search`. Field nullability mirrors the generated RPC Returns types
 * (`Database['public']['Functions']['reference_list'|'reference_search']`):
 * the `RETURNS TABLE` columns are typed non-null `string`, the two score fields
 * are present only on `reference_search`. `toReferenceListItem` maps this into
 * the nullable display shape `ReferenceListItem`.
 */
type RawReferenceRow = ReferenceListRpcRow & {
  embedding_score?: number;
  fulltext_score?: number;
};

function toReferenceListItem(row: RawReferenceRow): ReferenceListItem {
  return {
    reference_id: row.reference_id,
    title: row.title,
    summary_preview: row.summary_preview,
    body_preview: row.body_preview,
    source_url: row.source_url,
    published_at: row.published_at,
    primary_domain: row.primary_domain,
    primary_subtopic: row.primary_subtopic,
    layer: row.layer,
    ingestion_source: row.ingestion_source as ReferenceIngestionSource,
    source_document_id: row.source_document_id,
    embedding_score: row.embedding_score,
    fulltext_score: row.fulltext_score,
  };
}

// ---------------------------------------------------------------------------
// URL <-> filter/search state (B-15, B-17 — thin mirror of use-browse-filters).
//
// References carry a much smaller dimension set than browse, so this is a
// hand-rolled parser rather than a delegation to the shared browse hook (whose
// quality_issues/include_qa cross-derivation is content_items-specific).
// ---------------------------------------------------------------------------

function isIngestionSource(value: string): value is ReferenceIngestionSource {
  return value === 'rss_feed' || value === 'url_import';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReferenceData(): UseReferenceDataReturn {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const searchQuery = useMemo(
    () => searchParams.get('q') ?? undefined,
    [searchParams],
  );

  const filters: ReferenceFilters = useMemo(() => {
    const sourceRaw = searchParams.get('source');
    return {
      primary_domain: searchParams.get('domain') ?? undefined,
      primary_subtopic: searchParams.get('subtopic') ?? undefined,
      ingestion_source:
        sourceRaw && isIngestionSource(sourceRaw) ? sourceRaw : undefined,
      published_from: searchParams.get('from') ?? undefined,
      published_to: searchParams.get('to') ?? undefined,
    };
  }, [searchParams]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.primary_domain) count++;
    if (filters.primary_subtopic) count++;
    if (filters.ingestion_source) count++;
    if (filters.published_from || filters.published_to) count++;
    return count;
  }, [filters]);

  const isSearchMode = Boolean(searchQuery);
  const filtersKey = filters as Record<string, unknown>;

  // -------------------------------------------------------------------------
  // Default list mode — reference_list RPC via useInfiniteQuery (cursor =
  // offset). Filters ride as RPC PARAMS (server-side pushdown, B-31), never
  // client-applied — so pagination stays correct under filtering (B-19).
  // -------------------------------------------------------------------------

  // `filtersKey` already encodes every filter value the queryFn reads
  // (domain/subtopic/source/from/to); the lint rule cannot see through the
  // object indirection. Same pattern as `use-browse-data.ts`.
  /* eslint-disable @tanstack/query/exhaustive-deps -- filtersKey encodes all filter inputs to the queryFn */
  const listQuery = useInfiniteQuery<
    ReferenceListPage,
    Error,
    InfiniteData<ReferenceListPage>,
    readonly unknown[],
    number
  >({
    queryKey: queryKeys.references.list(filtersKey),
    queryFn: async ({ pageParam }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc('reference_list', {
        p_limit: PAGE_SIZE,
        p_offset: pageParam,
        p_primary_domain: filters.primary_domain,
        p_primary_subtopic: filters.primary_subtopic,
        p_ingestion_source: filters.ingestion_source,
        p_published_from: filters.published_from,
        p_published_to: filters.published_to,
      });

      if (error) throw error;

      const rows = (data ?? []) as RawReferenceRow[];
      const items = rows.map(toReferenceListItem);
      // A full page implies there may be more; a short page is the last one.
      const nextOffset =
        items.length >= PAGE_SIZE ? pageParam + items.length : null;

      return { items, nextOffset };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    enabled: !isSearchMode,
    staleTime: LIST_STALE_TIME,
  });
  /* eslint-enable @tanstack/query/exhaustive-deps */

  const listItems = useMemo(
    () => listQuery.data?.pages.flatMap((p) => p.items) ?? EMPTY_ITEMS,
    [listQuery.data],
  );

  // -------------------------------------------------------------------------
  // Search mode — POST the {111.9} reference-scoped endpoint. This is the
  // ONLY search path (NEVER /api/search, which is content_items-scoped, B-23).
  // Returns ReferenceListItem rows WITH scores; no pagination (ranked top-N).
  // -------------------------------------------------------------------------

  const searchResult = useQuery<ReferenceListItem[], Error>({
    queryKey: queryKeys.references.search(searchQuery ?? ''),
    queryFn: async ({ signal }) => {
      try {
        const data = await fetchJson<{ results: RawReferenceRow[] }>(
          '/api/search/reference',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: searchQuery,
              limit: SEARCH_RESULT_LIMIT,
            }),
            signal,
          },
        );
        return (data.results ?? []).map(toReferenceListItem);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'EMBEDDING_FAILED') {
          throw new Error(
            'Search is temporarily unavailable. Please try again shortly.',
          );
        }
        throw err;
      }
    },
    enabled: isSearchMode,
    staleTime: SEARCH_STALE_TIME,
  });

  const searchItems = searchResult.data ?? EMPTY_ITEMS;

  // -------------------------------------------------------------------------
  // URL writers (B-15, B-17). Each writer clones the current params so the
  // other dimension (search vs filters) rides through unchanged.
  // -------------------------------------------------------------------------

  const setSearchQuery = useCallback(
    (query: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (query) params.set('q', query);
      else params.delete('q');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, router, pathname],
  );

  const setFilters = useCallback(
    (next: Partial<ReferenceFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      if ('primary_domain' in next) {
        if (next.primary_domain) params.set('domain', next.primary_domain);
        else {
          params.delete('domain');
          // Clearing the domain clears the dependent subtopic too.
          params.delete('subtopic');
        }
      }
      if ('primary_subtopic' in next) {
        if (next.primary_subtopic)
          params.set('subtopic', next.primary_subtopic);
        else params.delete('subtopic');
      }
      if ('ingestion_source' in next) {
        if (next.ingestion_source) params.set('source', next.ingestion_source);
        else params.delete('source');
      }
      if ('published_from' in next) {
        if (next.published_from) params.set('from', next.published_from);
        else params.delete('from');
      }
      if ('published_to' in next) {
        if (next.published_to) params.set('to', next.published_to);
        else params.delete('to');
      }

      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, router, pathname],
  );

  const clearAll = useCallback(() => {
    router.push(pathname);
  }, [router, pathname]);

  // -------------------------------------------------------------------------
  // Unified return — list vs search mode selection.
  // -------------------------------------------------------------------------

  // Destructure the referentially-stable members off the query result so they
  // can sit in `useCallback` deps without the `@tanstack/query/no-unstable-deps`
  // hazard (the query object itself is a fresh reference each render).
  const {
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    isLoading: listIsLoading,
    error: listError,
  } = listQuery;

  const items = isSearchMode ? searchItems : listItems;
  const isLoading = isSearchMode ? searchResult.isLoading : listIsLoading;
  const error = isSearchMode
    ? (searchResult.error?.message ?? null)
    : (listError?.message ?? null);

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    items,
    isLoading,
    isLoadingMore: isFetchingNextPage,
    hasMore: isSearchMode ? false : (hasNextPage ?? false),
    loadMore,
    isSearchMode,
    error,
    searchQuery,
    filters,
    activeFilterCount,
    hasActiveQueryOrFilters: isSearchMode || activeFilterCount > 0,
    setSearchQuery,
    setFilters,
    clearAll,
  };
}
