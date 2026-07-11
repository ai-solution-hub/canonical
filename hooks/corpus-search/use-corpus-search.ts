'use client';

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';
import type {
  CorpusKind,
  CorpusSearchFilters,
  CorpusSearchResult,
} from '@/types/corpus-search';

/**
 * useCorpusSearch — polymorphic multi-grain corpus search (ID-135 {135.6},
 * read-boundary rewrite ID-144 {144.7}).
 *
 * Generalised clone of `hooks/reference/use-reference-data.ts` (single-caller,
 * copy-and-generalise per TECH §1.1 — `/reference` is left untouched). Unlike
 * reference (which has a browse-all list mode), corpus search has no
 * query-less browse mode: `/api/search` requires a non-empty `query`
 * (`SearchBodySchema.query` = `min(1)`), so the hook only fetches once `?q`
 * is present (BI-8 — the no-query guidance state is the caller's concern).
 *
 * Spec: TECH §3 BI-9/BI-10/BI-11/BI-15/BI-17/BI-20, §4 hooks + query-keys,
 * §5 mapping layer (AAT-2); id-144 TECH §2.3 (owner_kind routing +
 * scope_tag/source_url mapping, dropped client-side kind narrow).
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Mirrors `useReferenceData`'s `PAGE_SIZE` (TECH §3 BI-20). */
const PAGE_SIZE = 48;
const SEARCH_STALE_TIME = 30_000;

/** Stable empty default (components/CLAUDE.md — never hand a fresh `[]`). */
const EMPTY_ITEMS: CorpusSearchResult[] = [];

// ---------------------------------------------------------------------------
// The read-boundary mapping layer (AAT-2) — mirrors `toReferenceListItem`.
//
// `RawCorpusSearchRow` is the verified `hybrid_search` RPC row shape (24
// columns; `supabase/migrations/20260710221255_id144_hybrid_search_projection_filters.sql`,
// confirmed on disk at this HEAD) — the closest available fixture for "the
// ACTUAL /api/search emit", since the route itself still returns
// `results: z.array(z.unknown())` (untyped) pending {131.19}'s typed
// envelope (Task-level dependency, NOT a sibling Subtask dep). Only the
// columns this mapping layer reads are modelled; extend as the mapping's
// needs grow once {131.19} ships the typed response.
//
// id-144 closed the two gaps the {135.6} journal flagged for the Orchestrator
// (routed to {131.11}/{131.19}): `scope_tag` and `source_url` are now real
// projected columns (TECH §2.1), so `answer.scopeTags`/`reference.sourceUrl`
// no longer degrade to `[]`/`null`.
// ---------------------------------------------------------------------------

interface RawCorpusSearchRow {
  id: string;
  title: string | null;
  suggested_title: string | null;
  summary: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  /**
   * Per-arm value: the source_documents arm emits `sd.content_type` verbatim
   * — the DOCUMENT'S OWN taxonomy content-type value (e.g. 'guidance') —
   * while the other three arms emit their own owner_kind literal
   * ('q_a_pair' | 'content_chunk' | 'reference_item') into this same column.
   * id-144 resolved the drift this previously caused for kind routing by
   * adding the dedicated `owner_kind` column below — `resolveCorpusKind` now
   * reads `owner_kind` exclusively; `content_type` is retained here for
   * potential display use only, never for routing.
   */
  content_type: string;
  /**
   * BI-3: modelled for non-exposure auditability only — NEVER surfaced on
   * `CorpusSearchResult`. Not read by `resolveCorpusKind`/
   * `toCorpusSearchResult` below (kind derivation reads `owner_kind` only);
   * present here so a future accidental read is a visible diff.
   */
  similarity: number;
  /** q_a_pairs.scope_tag, carried through arm 3 only; NULL on the other 3 arms (TECH §2.1). */
  scope_tag: string[] | null;
  /** reference_items.source_url, carried through arm 4 only; NULL on the other 3 arms (TECH §2.1). */
  source_url: string | null;
  /**
   * The grain discriminator (`record_embeddings.owner_kind` vocabulary) —
   * the honest routing key `resolveCorpusKind` reads (TECH §2.2/§2.3):
   * `'source_document' | 'content_chunk' | 'q_a_pair' | 'reference_item'`.
   */
  owner_kind: string;
}

/** id-144 TECH §2.3: routes on the honest `owner_kind` grain key, never `content_type`. */
function resolveCorpusKind(ownerKind: string): CorpusKind {
  if (ownerKind === 'q_a_pair') return 'answer';
  if (ownerKind === 'reference_item') return 'reference';
  // 'source_document' and 'content_chunk' both collapse to `document`
  // (BI-12: content_chunk hits collapse to their source_document). Any
  // future, unrecognised owner_kind literal also falls through to
  // `document` — the honest-signal default until `CorpusKind` itself gains
  // a member (an id-135-contract change, out of scope here).
  return 'document';
}

function toCorpusSearchResult(row: RawCorpusSearchRow): CorpusSearchResult {
  const kind = resolveCorpusKind(row.owner_kind);
  // Prefer the classified `suggested_title` (BI-13 "classified title or
  // filename"); q_a_pair/reference_item arms never set suggested_title, so
  // this falls through to `title` for them unconditionally.
  const title = row.suggested_title ?? row.title ?? '';

  if (kind === 'answer') {
    return {
      id: row.id,
      kind: 'answer',
      title,
      // hybrid_search's q_a_pair arm truncates answer_standard into `summary`
      // — the answer preview.
      answerSnippet: row.summary ?? '',
      scopeTags: row.scope_tag ?? [],
      primaryDomain: row.primary_domain,
      primarySubtopic: row.primary_subtopic,
    };
  }

  if (kind === 'reference') {
    return {
      id: row.id,
      kind: 'reference',
      title,
      sourceUrl: row.source_url ?? null,
    };
  }

  return {
    id: row.id,
    kind: 'document',
    title,
    summary: row.summary,
    primaryDomain: row.primary_domain,
    primarySubtopic: row.primary_subtopic,
  };
}

// ---------------------------------------------------------------------------
// Pagination (BI-20, AAT-1 fallback).
//
// `hybrid_search` (confirmed on disk) has NO offset parameter — only
// `limit_count` (ranked top-N). Per AAT-1, this hook implements the
// "limit-raising load more" fallback: each page re-requests a LARGER
// cumulative `limit` and returns the full re-derived (mapped + kind-narrowed)
// result set for that limit, rather than an incremental delta. Because
// ordering is server-stable (BI-11/BI-20) this recomputation naturally
// satisfies "stable order, no cross-page dupes" — there is nothing to
// de-duplicate because each page IS the complete set, not an appended slice.
// `items` (below) simply reads the LAST (largest) page. Swap this for true
// offset/limit paging once {131.11}/{131.19} ship it — the public return
// shape (`items`/`hasMore`/`loadMore`) does not need to change.
// ---------------------------------------------------------------------------

interface CorpusSearchPage {
  /** The full re-derived (mapped + kind-narrowed) set for this page's cumulative limit. */
  items: CorpusSearchResult[];
  /** Cumulative limit for the NEXT fetch, or null when the server confirmed no more results. */
  nextLimit: number | null;
}

// ---------------------------------------------------------------------------
// Public shape
// ---------------------------------------------------------------------------

/** @public */
export interface UseCorpusSearchReturn {
  items: CorpusSearchResult[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /** A transport/RPC error from the search request, else null. */
  error: string | null;
  /** Current free-text query from `?q=`, or undefined when no search is active. */
  searchQuery: string | undefined;
  /** True once `?q` is non-empty — drives the BI-8 (no-query) vs BI-18 (no-results) split. */
  hasQuery: boolean;
  /** Current §9 type/scope narrow from `?kind=`, or undefined = ALL grains (BI-10). */
  kind: CorpusKind | undefined;
  /** Current filter set parsed from the URL (BI-16). */
  filters: CorpusSearchFilters;
  setSearchQuery: (query: string | undefined) => void;
  /** Sets the kind narrow (BI-15); `undefined` clears it, returning to ALL grains. */
  setKind: (kind: CorpusKind | undefined) => void;
  setFilters: (next: Partial<CorpusSearchFilters>) => void;
  clearAll: () => void;
}

function isCorpusKind(value: string): value is CorpusKind {
  return value === 'answer' || value === 'document' || value === 'reference';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCorpusSearch(): UseCorpusSearchReturn {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const searchQuery = useMemo(
    () => searchParams.get('q') ?? undefined,
    [searchParams],
  );
  const hasQuery = Boolean(searchQuery && searchQuery.trim().length > 0);

  const kind = useMemo(() => {
    const raw = searchParams.get('kind');
    return raw && isCorpusKind(raw) ? raw : undefined;
  }, [searchParams]);

  const filters: CorpusSearchFilters = useMemo(
    () => ({
      domain: searchParams.get('domain') ?? undefined,
      subtopic: searchParams.get('subtopic') ?? undefined,
      dateFrom: searchParams.get('from') ?? undefined,
      dateTo: searchParams.get('to') ?? undefined,
    }),
    [searchParams],
  );

  // `searchQuery`/`kind`/`filters` are all read inside queryFn AND fully
  // represented in the query key below (mirrors useReferenceData's
  // exhaustive-deps note) — no eslint escape hatch required.
  const query = useInfiniteQuery<
    CorpusSearchPage,
    Error,
    InfiniteData<CorpusSearchPage>,
    readonly unknown[],
    number
  >({
    queryKey: queryKeys.corpusSearch.search(searchQuery ?? '', kind, filters),
    queryFn: async ({ pageParam, signal }) => {
      const data = await fetchJson<{ results: RawCorpusSearchRow[] }>(
        '/api/search',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: searchQuery,
            kind, // Forward-compatible §9 type/scope narrow param (AAT-1/AAT-2).
            domain: filters.domain,
            subtopic: filters.subtopic,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            limit: pageParam,
          }),
          signal,
        },
      );

      const rows = data.results ?? [];
      // id-144 TECH §2.3/§2.4: the server now narrows authoritatively via
      // `hybrid_search`'s `filter_kind` param (applied BEFORE the `LIMIT`),
      // so `mapped` IS the final page — no client-side narrow is applied
      // here any more. The removed post-LIMIT `.filter()` was the OBS-4
      // pagination bug — it silently shrank a page below `PAGE_SIZE` by
      // narrowing AFTER the server had already truncated to the top-N.
      const mapped = rows.map(toCorpusSearchResult);

      // A short raw response (pre-narrow) is the server-confirmed end of
      // ALL results; a full response optimistically assumes more may exist
      // (mirrors useReferenceData's nextOffset heuristic).
      const reachedEnd = mapped.length < pageParam;

      return {
        items: mapped,
        nextLimit: reachedEnd ? null : pageParam + PAGE_SIZE,
      };
    },
    initialPageParam: PAGE_SIZE,
    getNextPageParam: (lastPage) => lastPage.nextLimit,
    enabled: hasQuery,
    staleTime: SEARCH_STALE_TIME,
  });

  const items = useMemo(
    () => query.data?.pages.at(-1)?.items ?? EMPTY_ITEMS,
    [query.data],
  );

  const { hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, error } =
    query;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // -------------------------------------------------------------------------
  // URL writers (BI-9, BI-15). Each clones the current params so the other
  // dimensions ride through unchanged.
  // -------------------------------------------------------------------------

  const setSearchQuery = useCallback(
    (nextQuery: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextQuery) params.set('q', nextQuery);
      else params.delete('q');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, router, pathname],
  );

  const setKind = useCallback(
    (nextKind: CorpusKind | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextKind) params.set('kind', nextKind);
      else params.delete('kind');
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [searchParams, router, pathname],
  );

  const setFilters = useCallback(
    (next: Partial<CorpusSearchFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      if ('domain' in next) {
        if (next.domain) params.set('domain', next.domain);
        else {
          params.delete('domain');
          // Clearing the domain clears the dependent subtopic too.
          params.delete('subtopic');
        }
      }
      if ('subtopic' in next) {
        if (next.subtopic) params.set('subtopic', next.subtopic);
        else params.delete('subtopic');
      }
      if ('dateFrom' in next) {
        if (next.dateFrom) params.set('from', next.dateFrom);
        else params.delete('from');
      }
      if ('dateTo' in next) {
        if (next.dateTo) params.set('to', next.dateTo);
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

  return {
    items,
    isLoading,
    isLoadingMore: isFetchingNextPage,
    hasMore: hasNextPage ?? false,
    loadMore,
    error: error?.message ?? null,
    searchQuery,
    hasQuery,
    kind,
    filters,
    setSearchQuery,
    setKind,
    setFilters,
    clearAll,
  };
}
