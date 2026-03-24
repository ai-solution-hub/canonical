'use client';

import { useState, useEffect, useCallback, useRef, type RefCallback } from 'react';
import { useBrowseFilters } from '@/hooks/use-browse-filters';
import { createClient } from '@/lib/supabase/client';
import { getCursorFromItem, isOffsetSort } from '@/lib/browse-helpers';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import { CONTENT_LIST_COLUMNS, type ContentListItem, type SearchResult } from '@/types/content';

const PAGE_SIZE = 48;
const SEARCH_RESULT_LIMIT = 50;

/** Safely cast Supabase select results to ContentListItem[]. */
function asContentListItems(data: unknown): ContentListItem[] {
  if (!Array.isArray(data)) return [];
  return data as ContentListItem[];
}

export interface FreshnessCounts {
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}

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
  updateItemLocally: (itemId: string, updates: Partial<ContentListItem>) => void;
  /** Optimistically toggle a quality flag for an item */
  updateQualityFlag: (itemId: string, flagged: boolean) => void;
}

/** Apply Browse filters as client-side post-filters on search results. */
function applyPostFilters(
  results: SearchResult[],
  filters: ReturnType<typeof useBrowseFilters>['filters'],
): ContentListItem[] {
  let filtered = results as (SearchResult & ContentListItem)[];

  if (filters.domain?.length) {
    const domainSet = new Set(filters.domain);
    filtered = filtered.filter((r) => r.primary_domain && domainSet.has(r.primary_domain));
  }
  if (filters.subtopic) {
    filtered = filtered.filter((r) => r.primary_subtopic === filters.subtopic);
  }
  if (filters.content_type?.length) {
    const typeSet = new Set(filters.content_type);
    filtered = filtered.filter((r) => r.content_type && typeSet.has(r.content_type));
  }
  if (filters.platform?.length) {
    const platformSet = new Set(filters.platform);
    filtered = filtered.filter((r) => r.platform && platformSet.has(r.platform));
  }
  if (filters.author?.length) {
    const authorSet = new Set(filters.author);
    filtered = filtered.filter((r) => r.author_name && authorSet.has(r.author_name));
  }
  if (filters.freshness?.length) {
    const freshnessSet = new Set(filters.freshness);
    filtered = filtered.filter((r) => r.freshness && freshnessSet.has(r.freshness));
  }
  if (filters.priority?.length) {
    const prioritySet = new Set(filters.priority);
    filtered = filtered.filter((r) => r.priority && prioritySet.has(r.priority));
  }
  if (filters.layer) {
    const layerValue = filters.layer;
    filtered = filtered.filter((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      return meta && meta['layer'] === layerValue;
    });
  }

  return filtered;
}

export function useBrowseData(): UseBrowseDataReturn {
  const supabase = createClient();
  const { filters, activeFilterCount, searchQuery, setFilters, setSearchQuery, clearSearchQuery, clearFilters } = useBrowseFilters();
  const isSearchMode = Boolean(searchQuery);

  // Data state
  const [items, setItems] = useState<ContentListItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  // Offset-based pagination for sorts where cursor-based is not viable
  const [offset, setOffset] = useState(0);

  // Quality flags
  const [qualityFlaggedIds, setQualityFlaggedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const fetchQualityFlags = async () => {
      const { data } = await supabase.rpc('get_items_with_quality_flags');
      if (data) setQualityFlaggedIds(new Set(data as string[]));
    };
    fetchQualityFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, []);

  // Freshness counts — lightweight query for the subtitle stats
  const [freshnessCounts, setFreshnessCounts] = useState<FreshnessCounts | null>(null);
  useEffect(() => {
    const fetchFreshnessCounts = async () => {
      const counts: FreshnessCounts = { fresh: 0, aging: 0, stale: 0, expired: 0 };
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
      for (let i = 0; i < states.length; i++) {
        counts[states[i]] = results[i].count ?? 0;
      }
      setFreshnessCounts(counts);
    };
    fetchFreshnessCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, []);

  // Search error state
  const [searchError, setSearchError] = useState<string | null>(null);

  // Abort controller for search API calls
  const searchAbortRef = useRef<AbortController | null>(null);

  // Track the current request to avoid stale responses
  const requestIdRef = useRef(0);

  // Manual refresh counter — incrementing triggers re-fetch
  const [refreshCounter, setRefreshCounter] = useState(0);
  const refreshData = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  // Resolve keyword search terms to matching IDs via server-side RPC
  const resolveKeywordIds = useCallback(async (): Promise<string[] | null> => {
    if (!filters.keywords?.length) return null;
    const { data, error } = await supabase.rpc('filter_by_keywords', {
      search_terms: filters.keywords,
    });
    if (error) {
      console.error('Keyword filter RPC failed:', error);
      return null;
    }
    return (data as string[]) ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [filters.keywords]);

  // Resolve workspace filter to matching content_item IDs
  const resolveWorkspaceIds = useCallback(async (): Promise<string[] | null> => {
    if (!filters.workspace) return null;
    const { data, error } = await supabase
      .from('content_item_workspaces')
      .select('content_item_id')
      .eq('workspace_id', filters.workspace);
    if (error) {
      console.error('Workspace filter failed:', error);
      return null;
    }
    return (data ?? []).map((row: { content_item_id: string }) => row.content_item_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [filters.workspace]);

  // Resolve quality issues filter to matching content_item IDs
  const resolveQualityIssueIds = useCallback(async (): Promise<string[] | null> => {
    if (!filters.quality_issues) return null;
    const { data, error } = await supabase.rpc('get_items_with_quality_flags');
    if (error) {
      console.error('Quality issues filter RPC failed:', error);
      return null;
    }
    return (data as string[]) ?? [];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [filters.quality_issues]);

  // Resolve 'me' owner filter to current user's UUID
  const resolveOwnerFilter = useCallback(async (): Promise<string | null> => {
    if (!filters.owner || filters.owner !== 'me') return filters.owner ?? null;
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [filters.owner]);

  // Resolve entity filter to matching content_item IDs
  // Supports filtering by entity name, entity type, or both
  const resolveEntityIds = useCallback(async (): Promise<string[] | null> => {
    if (!filters.entity && !filters.entity_type) return null;

    let query = supabase
      .from('entity_mentions')
      .select('content_item_id');

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
    // Deduplicate content_item_ids
    return [...new Set((data ?? []).map((row: { content_item_id: string }) => row.content_item_id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [filters.entity, filters.entity_type]);

  // Build the Supabase query with filters and cursor-based or offset-based pagination
  const buildQuery = useCallback(
    (
      cursorValue: string | null,
      isInitial: boolean,
      keywordMatchIds?: string[] | null,
      projectMatchIds?: string[] | null,
      qualityIssueIds?: string[] | null,
      entityMatchIds?: string[] | null,
      resolvedOwner?: string | null,
      offsetValue?: number,
    ) => {
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
        // Default: exclude Q&A pairs (they live in /library)
        // When quality_issues is active, include_qa is auto-set to true by
        // useBrowseFilters so all flagged items are visible
        // content_type is NOT NULL so .neq() is safe here
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
      // Collect all non-null ID sets, then intersect them
      const idSets: string[][] = [];
      if (keywordMatchIds) idSets.push(keywordMatchIds);
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
        query = query.eq('metadata->>layer', filters.layer);
      }

      // Exclude draft items by default (unless include_drafts filter is on)
      if (!filters.include_drafts) {
        query = query.or('governance_review_status.is.null,governance_review_status.neq.draft');
      }

      // Review status filter (verified/unverified/flagged)
      if (filters.review_status === 'verified') {
        query = query.not('verified_at', 'is', null);
      } else if (filters.review_status === 'unverified') {
        query = query.is('verified_at', null);
      } else if (filters.review_status === 'flagged') {
        query = query.eq('governance_review_status', 'pending');
      }

      if (filters.starred) {
        query = query.eq('metadata->>starred', 'true');
      }

      if (filters.priority?.length) {
        query = query.in('priority', filters.priority);
      }

      if (filters.user_tags?.length) {
        query = query.overlaps('user_tags', filters.user_tags);
      }

      // Owner filter: 'unowned' filters null, UUID filters specific owner
      // 'me' is resolved to the user's UUID by resolveOwnerFilter() before buildQuery
      if (filters.owner === 'unowned') {
        query = query.is('content_owner_id', null);
      } else if (resolvedOwner) {
        query = query.eq('content_owner_id', resolvedOwner);
      }

      // Apply sorting + cursor
      const sort = filters.sort ?? 'captured_date';
      const order = filters.order ?? 'desc';

      if (sort === 'primary_domain') {
        // Composite sort: domain asc, then date desc, tiebreak by id
        query = query
          .order('primary_domain', { ascending: true })
          .order('captured_date', { ascending: false })
          .order('id', { ascending: true });

        // Cursor for domain sort: "domain|date|id"
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
        // Confidence desc, tiebreak by id
        query = query
          .order('classification_confidence', {
            ascending: false,
            nullsFirst: false,
          })
          .order('id', { ascending: true });

        // Cursor: "confidence|id"
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
        // Freshness sort: stale/expired first (asc: expired < stale < aging < fresh)
        // Uses offset-based pagination since freshness is non-unique and not orderable as a cursor.
        query = query
          .order('freshness', { ascending: true, nullsFirst: false })
          .order('captured_date', { ascending: false })
          .order('id', { ascending: true });
      } else if (sort === 'quality_score') {
        // Quality score sort: lowest first for governance review
        // Uses offset-based pagination since quality_score is non-unique.
        query = query
          .order('quality_score', { ascending: true, nullsFirst: false })
          .order('captured_date', { ascending: false })
          .order('id', { ascending: true });
      }

      // Offset-based sorts use .range(); cursor-based sorts use .limit()
      if (isOffsetSort(sort) && offsetValue != null && offsetValue > 0) {
        query = query.range(offsetValue, offsetValue + PAGE_SIZE - 1);
      } else {
        query = query.limit(PAGE_SIZE);
      }

      return query;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
    [filters],
  );

  // Fetch initial data when filters change — reset cursor
  // In search mode, calls /api/search; otherwise uses direct Supabase query
  useEffect(() => {
    const currentRequestId = ++requestIdRef.current;

    const fetchData = async () => {
      setIsLoading(true);
      setItems([]);
      setCursor(null);
      setOffset(0);
      setSearchError(null);

      // --- SEARCH MODE: call /api/search ---
      if (searchQuery) {
        // Abort previous search request
        searchAbortRef.current?.abort();
        const controller = new AbortController();
        searchAbortRef.current = controller;

        try {
          const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: searchQuery,
              threshold: 0.35,
              limit: SEARCH_RESULT_LIMIT,
            }),
            signal: controller.signal,
          });

          if (currentRequestId !== requestIdRef.current) return;

          if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const code = (errData as Record<string, unknown>).code;
            if (code === 'EMBEDDING_FAILED') {
              setSearchError('Search is temporarily unavailable. Please try again shortly.');
            } else {
              setSearchError((errData as Record<string, unknown>).error as string || 'Search failed');
            }
            setIsLoading(false);
            return;
          }

          const data = await response.json();
          const searchResults = (data.results ?? []) as SearchResult[];

          // Apply browse filters as client-side post-filters
          const postFiltered = applyPostFilters(searchResults, filters);

          setItems(postFiltered);
          setTotalCount(postFiltered.length);
          setHasMore(false); // Search returns all results up to the limit
          setIsLoading(false);
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') return;
          if (currentRequestId !== requestIdRef.current) return;
          setSearchError(err instanceof Error ? err.message : 'Search failed');
          setIsLoading(false);
        }
        return;
      }

      // --- FILTER MODE: direct Supabase query (existing behaviour) ---

      // Resolve keyword + project + quality issue + entity + owner filters via server-side lookups
      const [keywordIds, projectIds, qualityIds, entityIds, resolvedOwner] = await Promise.all([
        resolveKeywordIds(),
        resolveWorkspaceIds(),
        resolveQualityIssueIds(),
        resolveEntityIds(),
        resolveOwnerFilter(),
      ]);
      if (
        (keywordIds !== null && keywordIds.length === 0) ||
        (projectIds !== null && projectIds.length === 0) ||
        (qualityIds !== null && qualityIds.length === 0) ||
        (entityIds !== null && entityIds.length === 0)
      ) {
        // Filter was specified but nothing matched
        if (currentRequestId !== requestIdRef.current) return;
        setItems([]);
        setTotalCount(0);
        setHasMore(false);
        setIsLoading(false);
        return;
      }

      const { data, count, error } = await buildQuery(null, true, keywordIds, projectIds, qualityIds, entityIds, resolvedOwner);

      // Discard stale response
      if (currentRequestId !== requestIdRef.current) return;

      if (error) {
        console.error('Failed to fetch content items:', error);
        setIsLoading(false);
        return;
      }

      const fetchedItems = asContentListItems(data);
      setItems(fetchedItems);
      setTotalCount(count);
      setHasMore(fetchedItems.length >= PAGE_SIZE);

      // Set cursor or offset from last batch
      const sort = filters.sort ?? 'captured_date';
      if (isOffsetSort(sort)) {
        setOffset(fetchedItems.length);
      } else if (fetchedItems.length > 0) {
        const lastItem = fetchedItems[fetchedItems.length - 1];
        setCursor(getCursorFromItem(lastItem, sort));
      }

      setIsLoading(false);
    };

    fetchData();

    // Cleanup: abort in-flight search on unmount or re-run
    return () => {
      searchAbortRef.current?.abort();
    };
  }, [buildQuery, resolveKeywordIds, resolveWorkspaceIds, resolveQualityIssueIds, resolveEntityIds, resolveOwnerFilter, filters, searchQuery, refreshCounter]);

  // Load more using cursor-based or offset-based pagination
  const handleLoadMore = useCallback(async () => {
    const sort = filters.sort ?? 'captured_date';
    const usingOffset = isOffsetSort(sort);

    // For cursor-based sorts we need a cursor; for offset-based sorts we need a non-zero offset
    if (isLoadingMore || !hasMore) return;
    if (!usingOffset && !cursor) return;

    setIsLoadingMore(true);

    const [keywordIds, projectIds, qualityIds, entityIds, resolvedOwner] = await Promise.all([
      resolveKeywordIds(),
      resolveWorkspaceIds(),
      resolveQualityIssueIds(),
      resolveEntityIds(),
      resolveOwnerFilter(),
    ]);
    const { data, error } = await buildQuery(
      cursor,
      false,
      keywordIds,
      projectIds,
      qualityIds,
      entityIds,
      resolvedOwner,
      usingOffset ? offset : undefined,
    );

    if (error) {
      console.error('Failed to load more items:', error);
      setIsLoadingMore(false);
      return;
    }

    const newItems = asContentListItems(data);
    setItems((prev) => [...prev, ...newItems]);
    setHasMore(newItems.length >= PAGE_SIZE);

    // Update cursor or offset from last batch
    if (usingOffset) {
      setOffset((prev) => prev + newItems.length);
    } else if (newItems.length > 0) {
      const lastItem = newItems[newItems.length - 1];
      setCursor(getCursorFromItem(lastItem, sort));
    }

    setIsLoadingMore(false);
  }, [
    isLoadingMore,
    hasMore,
    cursor,
    offset,
    buildQuery,
    resolveKeywordIds,
    resolveWorkspaceIds,
    resolveQualityIssueIds,
    resolveEntityIds,
    resolveOwnerFilter,
    filters.sort,
  ]);

  // Infinite scroll — IntersectionObserver sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const handleLoadMoreRef = useRef(handleLoadMore);
  handleLoadMoreRef.current = handleLoadMore;

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
        if (entries[0]?.isIntersecting) {
          handleLoadMoreRef.current();
        }
      },
      { rootMargin: '200px', threshold: 0 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    // Re-create observer when these change so the sentinel ref stays current
    hasMore,
    isLoading,
    isLoadingMore,
  ]);

  /** Optimistically update a single item's fields in the local items array */
  const updateItemLocally = useCallback(
    (itemId: string, updates: Partial<ContentListItem>) => {
      setItems((prev) =>
        prev.map((item) =>
          item.id === itemId ? { ...item, ...updates } : item,
        ),
      );
    },
    [],
  );

  /** Optimistically toggle a quality flag for an item */
  const updateQualityFlag = useCallback(
    (itemId: string, flagged: boolean) => {
      setQualityFlaggedIds((prev) => {
        const next = new Set(prev);
        if (flagged) {
          next.add(itemId);
        } else {
          next.delete(itemId);
        }
        return next;
      });
    },
    [],
  );

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
