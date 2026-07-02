'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type RefCallback,
} from 'react';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { useBrowseFilters } from '@/hooks/browse/use-browse-filters';
import { createClient } from '@/lib/supabase/client';
import { getCursorFromItem, isOffsetSort } from '@/lib/browse-helpers';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson, ApiError } from '@/lib/query/fetchers';
import {
  CONTENT_LIST_COLUMNS,
  type ContentListItem,
  type SearchResult,
  type BrowseFilters,
} from '@/types/content';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 48;
const SEARCH_RESULT_LIMIT = 50;
const BROWSE_STALE_TIME = 30_000;
const AUXILIARY_STALE_TIME = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single page of browse results returned by useInfiniteQuery's queryFn. */
interface BrowsePage {
  items: ContentListItem[];
  totalCount: number | null;
  nextPageParam: PageParam | null;
}

/** Discriminated union for cursor-based vs offset-based pagination. */
type PageParam =
  | { type: 'cursor'; value: string }
  | { type: 'offset'; value: number };

/** @public */
export interface FreshnessCounts {
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}

/** @public */
export interface UseBrowseDataReturn {
  items: ContentListItem[];
  totalCount: number | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  qualityFlaggedIds: Set<string>;
  freshnessCounts: FreshnessCounts | null;
  sentinelCallbackRef: RefCallback<HTMLDivElement>;
  /** Re-run the initial fetch (e.g. after an upload or mutation) */
  refreshData: () => void;
  /** Expose filters passthrough so the component doesn't need a separate useBrowseFilters() call */
  filters: ReturnType<typeof useBrowseFilters>['filters'];
  activeFilterCount: ReturnType<typeof useBrowseFilters>['activeFilterCount'];
  setFilters: ReturnType<typeof useBrowseFilters>['setFilters'];
  /** Active search query from URL ?q= parameter */
  searchQuery: string | undefined;
  /** Set or clear the search query */
  setSearchQuery: ReturnType<typeof useBrowseFilters>['setSearchQuery'];
  clearSearchQuery: ReturnType<typeof useBrowseFilters>['clearSearchQuery'];
  /** Clear all filters, navigating back to the unfiltered browse page */
  clearFilters: ReturnType<typeof useBrowseFilters>['clearFilters'];
  /** True when results are from search API rather than direct Supabase query */
  isSearchMode: boolean;
  /** Search error message, if any */
  searchError: string | null;
  /** Optimistically update a single item's fields in local state */
  updateItemLocally: (
    itemId: string,
    updates: Partial<ContentListItem>,
  ) => void;
  /** Optimistically toggle a quality flag for an item */
  updateQualityFlag: (itemId: string, flagged: boolean) => void;
}

// ---------------------------------------------------------------------------
// Pure helper: safely cast Supabase select results to ContentListItem[]
// ---------------------------------------------------------------------------

function asContentListItems(data: unknown): ContentListItem[] {
  if (!Array.isArray(data)) return [];
  return data as ContentListItem[];
}

// ---------------------------------------------------------------------------
// Pure helper: apply Browse filters as client-side post-filters on search results
// ---------------------------------------------------------------------------

function applyPostFilters(
  results: SearchResult[],
  filters: BrowseFilters,
): ContentListItem[] {
  let filtered = results as (SearchResult & ContentListItem)[];

  if (filters.domain?.length) {
    const domainSet = new Set(filters.domain);
    filtered = filtered.filter(
      (r) => r.primary_domain && domainSet.has(r.primary_domain),
    );
  }
  if (filters.subtopic) {
    filtered = filtered.filter((r) => r.primary_subtopic === filters.subtopic);
  }
  if (filters.content_type?.length) {
    const typeSet = new Set(filters.content_type);
    filtered = filtered.filter(
      (r) => r.content_type && typeSet.has(r.content_type),
    );
  }
  if (filters.platform?.length) {
    const platformSet = new Set(filters.platform);
    filtered = filtered.filter(
      (r) => r.platform && platformSet.has(r.platform),
    );
  }
  if (filters.author?.length) {
    const authorSet = new Set(filters.author);
    filtered = filtered.filter(
      (r) => r.author_name && authorSet.has(r.author_name),
    );
  }
  if (filters.freshness?.length) {
    const freshnessSet = new Set(filters.freshness);
    filtered = filtered.filter(
      (r) => r.freshness && freshnessSet.has(r.freshness),
    );
  }
  if (filters.priority?.length) {
    const prioritySet = new Set(filters.priority);
    filtered = filtered.filter(
      (r) => r.priority && prioritySet.has(r.priority),
    );
  }
  if (filters.layer) {
    const layerValue = filters.layer;
    filtered = filtered.filter((r) => r.layer === layerValue);
  }
  if (filters.source) {
    const sourceValue = filters.source;
    filtered = filtered.filter(
      (r) =>
        r.metadata &&
        (r.metadata as Record<string, unknown>).source === sourceValue,
    );
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Pre-filter resolvers (pure async functions — not hooks)
// ---------------------------------------------------------------------------

type SupabaseClient = ReturnType<typeof createClient>;

// ID-131.11 G-SEARCH (§9 §7.5 / AC6): the browse-mode keyword pre-filter
// resolver (`resolveKeywordIds`) is removed — the `filter_by_keywords` RPC it
// called is DROPPED by the M5 migration (redundant with the hybrid_search
// keyword leg). A keyword pre-filter becomes a backlog facet-param on
// hybrid_search; no surviving caller of the dropped RPC remains.

async function resolveWorkspaceIds(
  supabase: SupabaseClient,
  filters: BrowseFilters,
): Promise<string[] | null> {
  if (!filters.workspace) return null;
  const { data, error } = await supabase
    .from('content_item_workspaces')
    .select('content_item_id')
    .eq('workspace_id', filters.workspace);
  if (error) {
    console.error('Workspace filter failed:', error);
    return null;
  }
  return (data ?? []).map(
    (row: { content_item_id: string }) => row.content_item_id,
  );
}

async function resolveQualityIssueIds(
  supabase: SupabaseClient,
  filters: BrowseFilters,
): Promise<string[] | null> {
  if (!filters.quality_issues) return null;
  const { data, error } = await supabase.rpc('get_items_with_quality_flags');
  if (error) {
    console.error('Quality issues filter RPC failed:', error);
    return null;
  }
  return (data as string[]) ?? [];
}

async function resolveOwnerFilter(
  supabase: SupabaseClient,
  filters: BrowseFilters,
): Promise<string | null> {
  if (!filters.owner || filters.owner !== 'me') return filters.owner ?? null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

async function resolveEntityIds(
  supabase: SupabaseClient,
  filters: BrowseFilters,
): Promise<string[] | null> {
  if (!filters.entity && !filters.entity_type) return null;

  let query = supabase.from('entity_mentions').select('source_document_id');

  if (filters.entity) {
    query = query.eq('canonical_name', filters.entity);
  }
  if (filters.entity_type) {
    query = query.eq('entity_type', filters.entity_type);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Entity filter failed:', error);
    return null;
  }
  return [
    ...new Set(
      (data ?? []).map(
        (row: { source_document_id: string }) => row.source_document_id,
      ),
    ),
  ];
}

// ---------------------------------------------------------------------------
// Pure helper: build the Supabase query with filters and pagination
// ---------------------------------------------------------------------------

function buildBrowseQuery(
  supabase: SupabaseClient,
  filters: BrowseFilters,
  cursorValue: string | null,
  isInitial: boolean,
  projectMatchIds: string[] | null,
  qualityIssueIds: string[] | null,
  entityMatchIds: string[] | null,
  resolvedOwner: string | null,
  offsetValue: number,
) {
  let query = supabase
    .from('content_items')
    .select(
      CONTENT_LIST_COLUMNS.trim(),
      isInitial ? { count: 'exact' } : { count: undefined },
    );

  // Apply multi-select filters using .in()
  if (filters.domain?.length) {
    query = query.in('primary_domain', filters.domain);
  }

  if (filters.subtopic) {
    query = query.eq('primary_subtopic', filters.subtopic);
  }

  if (filters.content_type?.length) {
    query = query.in('content_type', filters.content_type);
  } else if (!filters.include_qa) {
    query = query.neq('content_type', 'q_a_pair');
  }

  if (filters.platform?.length) {
    query = query.in('platform', filters.platform);
  }

  if (filters.author?.length) {
    query = query.in('author_name', filters.author);
  }

  if (filters.date_from) {
    query = query.gte('captured_date', filters.date_from);
  }

  if (filters.date_to) {
    query = query.lte('captured_date', filters.date_to);
  }

  // Apply ID-based filters (keywords, project membership, quality issues)
  const idSets: string[][] = [];
  if (projectMatchIds) idSets.push(projectMatchIds);
  if (qualityIssueIds) idSets.push(qualityIssueIds);
  if (entityMatchIds) idSets.push(entityMatchIds);

  if (idSets.length > 0) {
    let intersection = idSets[0];
    for (let i = 1; i < idSets.length; i++) {
      const currentSet = new Set(idSets[i]);
      intersection = intersection.filter((id) => currentSet.has(id));
    }
    query = query.in('id', intersection.length ? intersection : ['__none__']);
  }

  if (filters.freshness?.length) {
    query = query.in('freshness', filters.freshness);
  }

  if (filters.layer) {
    query = query.eq('layer', filters.layer);
  }

  // Exclude draft items by default
  if (!filters.include_drafts) {
    query = query.or(
      'governance_review_status.is.null,governance_review_status.neq.draft',
    );
  }

  // Review status filter
  if (filters.review_status === 'verified') {
    query = query.not('verified_at', 'is', null);
  } else if (filters.review_status === 'unverified') {
    query = query.is('verified_at', null);
  } else if (filters.review_status === 'flagged') {
    query = query.eq('governance_review_status', 'pending');
  }

  if (filters.starred) {
    query = query.eq('starred', true);
  }

  if (filters.priority?.length) {
    query = query.in('priority', filters.priority);
  }

  if (filters.user_tags?.length) {
    query = query.overlaps('user_tags', filters.user_tags);
  }

  // Source filter (metadata JSONB path)
  if (filters.source) {
    query = query.eq('metadata->>source' as 'metadata', filters.source);
  }

  // Owner filter
  if (filters.owner === 'unowned') {
    query = query.is('content_owner_id', null);
  } else if (resolvedOwner) {
    query = query.eq('content_owner_id', resolvedOwner);
  }

  // Apply sorting + cursor
  const sort = filters.sort ?? 'captured_date';
  const order = filters.order ?? 'desc';

  if (sort === 'primary_domain') {
    query = query
      .order('primary_domain', { ascending: true })
      .order('captured_date', { ascending: false })
      .order('id', { ascending: true });

    if (cursorValue) {
      const [curDomain, curDate, curId] = cursorValue.split('|');
      const eDomain = escapePostgrestValue(curDomain);
      const eDate = escapePostgrestValue(curDate);
      const eId = escapePostgrestValue(curId);
      query = query.or(
        `primary_domain.gt.${eDomain},` +
          `and(primary_domain.eq.${eDomain},captured_date.lt.${eDate}),` +
          `and(primary_domain.eq.${eDomain},captured_date.eq.${eDate},id.gt.${eId})`,
      );
    }
  } else if (sort === 'classification_confidence') {
    query = query
      .order('classification_confidence', {
        ascending: false,
        nullsFirst: false,
      })
      .order('id', { ascending: true });

    if (cursorValue) {
      const [curConf, curId] = cursorValue.split('|');
      const eConf = escapePostgrestValue(curConf);
      const eId = escapePostgrestValue(curId);
      query = query.or(
        `classification_confidence.lt.${eConf},` +
          `and(classification_confidence.eq.${eConf},id.gt.${eId})`,
      );
    }
  } else if (sort === 'captured_date' && order === 'desc') {
    query = query
      .order('captured_date', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true });

    if (cursorValue) {
      query = query.lt('captured_date', cursorValue);
    }
  } else if (sort === 'captured_date' && order === 'asc') {
    query = query
      .order('captured_date', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (cursorValue) {
      query = query.gt('captured_date', cursorValue);
    }
  } else if (sort === 'freshness') {
    query = query
      .order('freshness', { ascending: true, nullsFirst: false })
      .order('captured_date', { ascending: false })
      .order('id', { ascending: true });
  } else if (sort === 'quality_score') {
    query = query
      .order('quality_score', { ascending: true, nullsFirst: false })
      .order('captured_date', { ascending: false })
      .order('id', { ascending: true });
  }

  // Offset-based sorts use .range(); cursor-based sorts use .limit()
  if (isOffsetSort(sort) && offsetValue > 0) {
    query = query.range(offsetValue, offsetValue + PAGE_SIZE - 1);
  } else {
    query = query.limit(PAGE_SIZE);
  }

  return query;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBrowseData(): UseBrowseDataReturn {
  const queryClient = useQueryClient();
  const {
    filters,
    activeFilterCount,
    searchQuery,
    setFilters,
    setSearchQuery,
    clearSearchQuery,
    clearFilters,
  } = useBrowseFilters();

  const isSearchMode = Boolean(searchQuery);

  // Cast filters to Record<string, unknown> for use in query keys.
  // Filters from useBrowseFilters are already plain serialisable objects.
  const filtersKey = filters as Record<string, unknown>;

  // -------------------------------------------------------------------------
  // Pre-filter resolution cache: resolvers only re-run when the filter values
  // they depend on change, not on every page fetch (load-more).
  // -------------------------------------------------------------------------

  const resolverCacheRef = useRef<{
    key: string;
    result: {
      workspaceIds: string[] | null;
      qualityIds: string[] | null;
      entityIds: string[] | null;
      resolvedOwner: string | null;
    };
  } | null>(null);

  const resolverCacheKey = JSON.stringify({
    workspace: filters.workspace,
    quality_issues: filters.quality_issues,
    entity: filters.entity,
    entity_type: filters.entity_type,
    owner: filters.owner,
  });

  // -------------------------------------------------------------------------
  // Browse mode: useInfiniteQuery for filter-mode with cursor/offset pagination
  // -------------------------------------------------------------------------

  // `filtersKey` already encodes every filter value (workspace,
  // quality_issues, entity, entity_type, owner) that `resolverCacheKey`
  // hashes; the resolver cache ref is an intra-query optimisation that
  // avoids duplicate resolver calls across paged fetches, not a cache-key
  // dimension. The lint rule cannot see through this indirection.
  /* eslint-disable @tanstack/query/exhaustive-deps -- filtersKey already encodes all resolver-cache inputs; resolver cache is an intra-query optimisation, not a cache-key dimension */
  const browseQuery = useInfiniteQuery<
    BrowsePage,
    Error,
    InfiniteData<BrowsePage>,
    readonly unknown[],
    PageParam | null
  >({
    queryKey: queryKeys.contentItems.browse(filtersKey),
    queryFn: async ({ pageParam }) => {
      const supabase = createClient();
      const isInitial = pageParam === null;
      const sort = filters.sort ?? 'captured_date';

      // Use cached resolver results if filter values haven't changed
      type ResolverResult = {
        workspaceIds: string[] | null;
        qualityIds: string[] | null;
        entityIds: string[] | null;
        resolvedOwner: string | null;
      };
      let resolved: ResolverResult;
      if (resolverCacheRef.current?.key === resolverCacheKey) {
        resolved = resolverCacheRef.current.result;
      } else {
        const [workspaceIds, qualityIds, entityIds, resolvedOwner] =
          await Promise.all([
            resolveWorkspaceIds(supabase, filters),
            resolveQualityIssueIds(supabase, filters),
            resolveEntityIds(supabase, filters),
            resolveOwnerFilter(supabase, filters),
          ]);
        resolved = {
          workspaceIds,
          qualityIds,
          entityIds,
          resolvedOwner,
        };
        resolverCacheRef.current = { key: resolverCacheKey, result: resolved };
      }

      const { workspaceIds, qualityIds, entityIds, resolvedOwner } = resolved;

      // Short-circuit if any required filter resolved to empty
      if (
        (workspaceIds !== null && workspaceIds.length === 0) ||
        (qualityIds !== null && qualityIds.length === 0) ||
        (entityIds !== null && entityIds.length === 0)
      ) {
        return { items: [], totalCount: 0, nextPageParam: null };
      }

      // Extract cursor/offset from pageParam
      const cursorValue = pageParam?.type === 'cursor' ? pageParam.value : null;
      const offsetValue = pageParam?.type === 'offset' ? pageParam.value : 0;

      const { data, count, error } = await buildBrowseQuery(
        supabase,
        filters,
        cursorValue,
        isInitial,
        workspaceIds,
        qualityIds,
        entityIds,
        resolvedOwner,
        offsetValue,
      );

      if (error) throw error;

      const items = asContentListItems(data);

      // Compute next page param
      let nextPageParam: PageParam | null = null;
      if (items.length >= PAGE_SIZE) {
        if (isOffsetSort(sort)) {
          const currentOffset =
            pageParam?.type === 'offset' ? pageParam.value : 0;
          nextPageParam = {
            type: 'offset',
            value: currentOffset + items.length,
          };
        } else if (items.length > 0) {
          const lastItem = items[items.length - 1];
          const cursorStr = getCursorFromItem(lastItem, sort);
          if (cursorStr) {
            nextPageParam = { type: 'cursor', value: cursorStr };
          }
        }
      }

      return {
        items,
        totalCount: isInitial ? (count ?? null) : null,
        nextPageParam,
      };
    },
    initialPageParam: null as PageParam | null,
    getNextPageParam: (lastPage) => lastPage.nextPageParam,
    enabled: !isSearchMode,
    staleTime: BROWSE_STALE_TIME,
  });
  /* eslint-enable @tanstack/query/exhaustive-deps */

  // Flatten pages into items array
  const browseItems = useMemo(
    () => browseQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [browseQuery.data],
  );

  // Total count from first page
  const browseTotalCount = browseQuery.data?.pages[0]?.totalCount ?? null;

  // -------------------------------------------------------------------------
  // Search mode: useQuery (no pagination — all results returned at once)
  // -------------------------------------------------------------------------

  const searchResult = useQuery<SearchResult[], Error>({
    queryKey: queryKeys.contentItems.search(searchQuery ?? ''),
    queryFn: async ({ signal }) => {
      try {
        const data = await fetchJson<{ results: SearchResult[] }>(
          '/api/search',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: searchQuery,
              threshold: 0.35,
              limit: SEARCH_RESULT_LIMIT,
            }),
            signal,
          },
        );
        return data.results ?? [];
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
    staleTime: AUXILIARY_STALE_TIME,
  });

  // Apply post-filters on search results
  const searchItems = useMemo(() => {
    if (!searchResult.data) return [];
    return applyPostFilters(searchResult.data, filters);
  }, [searchResult.data, filters]);

  const searchError = searchResult.error?.message ?? null;

  // -------------------------------------------------------------------------
  // Quality flags: useQuery
  // -------------------------------------------------------------------------

  const { data: qualityFlaggedIds = new Set<string>() } = useQuery<Set<string>>(
    {
      queryKey: queryKeys.qualityFlags.flaggedIds,
      queryFn: async () => {
        const supabase = createClient();
        const { data, error } = await supabase.rpc(
          'get_items_with_quality_flags',
        );
        if (error) throw error;
        return new Set((data as string[]) ?? []);
      },
      staleTime: AUXILIARY_STALE_TIME,
      // Set objects are not compatible with TanStack Query's structural sharing
      structuralSharing: false,
    },
  );

  // -------------------------------------------------------------------------
  // Freshness counts: useQuery
  // -------------------------------------------------------------------------

  const { data: freshnessCounts = null } = useQuery<FreshnessCounts>({
    queryKey: queryKeys.freshness.counts,
    queryFn: async (): Promise<FreshnessCounts> => {
      const supabase = createClient();
      const states = ['fresh', 'aging', 'stale', 'expired'] as const;
      const results = await Promise.all(
        states.map((state) =>
          supabase
            .from('content_items')
            .select('id', { count: 'exact', head: true })
            .eq('freshness', state)
            .neq('content_type', 'q_a_pair'),
        ),
      );
      const counts: FreshnessCounts = {
        fresh: 0,
        aging: 0,
        stale: 0,
        expired: 0,
      };
      for (let i = 0; i < states.length; i++) {
        counts[states[i]] = results[i].count ?? 0;
      }
      return counts;
    },
    staleTime: AUXILIARY_STALE_TIME,
  });

  // -------------------------------------------------------------------------
  // Refresh data via query invalidation
  // -------------------------------------------------------------------------

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.contentItems.all,
    });
  }, [queryClient]);

  // -------------------------------------------------------------------------
  // Infinite scroll sentinel — IntersectionObserver
  // -------------------------------------------------------------------------

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchNextPageRef = useRef(browseQuery.fetchNextPage);
  fetchNextPageRef.current = browseQuery.fetchNextPage;
  const hasNextPage = browseQuery.hasNextPage;
  const isFetchingNextPage = browseQuery.isFetchingNextPage;

  const sentinelCallbackRef: RefCallback<HTMLDivElement> = useCallback(
    (node) => {
      sentinelRef.current = node;
    },
    [],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPageRef.current();
        }
      },
      { rootMargin: '200px', threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, browseQuery.isLoading, isFetchingNextPage]);

  // -------------------------------------------------------------------------
  // Optimistic updates via queryClient.setQueryData
  // -------------------------------------------------------------------------

  const updateItemLocally = useCallback(
    (itemId: string, updates: Partial<ContentListItem>) => {
      // Update the browse (infinite query) cache
      queryClient.setQueryData<InfiniteData<BrowsePage>>(
        queryKeys.contentItems.browse(filtersKey),
        (old) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.id === itemId ? { ...item, ...updates } : item,
              ),
            })),
          };
        },
      );

      // Also update the search cache if in search mode
      if (searchQuery) {
        queryClient.setQueryData<SearchResult[]>(
          queryKeys.contentItems.search(searchQuery),
          (old) =>
            old?.map((item) =>
              item.id === itemId ? { ...item, ...updates } : item,
            ),
        );
      }
    },
    [queryClient, filtersKey, searchQuery],
  );

  const updateQualityFlag = useCallback(
    (itemId: string, flagged: boolean) => {
      queryClient.setQueryData<Set<string>>(
        queryKeys.qualityFlags.flaggedIds,
        (old) => {
          const next = new Set(old);
          if (flagged) next.add(itemId);
          else next.delete(itemId);
          return next;
        },
      );
    },
    [queryClient],
  );

  // -------------------------------------------------------------------------
  // Unified return value — preserves UseBrowseDataReturn interface exactly
  // -------------------------------------------------------------------------

  const items = isSearchMode ? searchItems : browseItems;
  const totalCount = isSearchMode ? searchItems.length : browseTotalCount;
  const isLoading = isSearchMode
    ? searchResult.isLoading
    : browseQuery.isLoading;
  const isLoadingMore = browseQuery.isFetchingNextPage;
  const hasMore = isSearchMode ? false : (browseQuery.hasNextPage ?? false);

  return {
    items,
    totalCount,
    isLoading,
    isLoadingMore,
    hasMore,
    qualityFlaggedIds,
    freshnessCounts,
    sentinelCallbackRef,
    refreshData,
    filters,
    activeFilterCount,
    setFilters,
    searchQuery,
    setSearchQuery,
    clearSearchQuery,
    clearFilters,
    isSearchMode,
    searchError,
    updateItemLocally,
    updateQualityFlag,
  };
}
