'use client';

import { useState, useEffect, useCallback, useRef, type RefCallback } from 'react';
import { useBrowseFilters } from '@/hooks/use-browse-filters';
import { createClient } from '@/lib/supabase/client';
import { getCursorFromItem } from '@/lib/browse-helpers';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import { CONTENT_LIST_COLUMNS, type ContentListItem } from '@/types/content';

const PAGE_SIZE = 48;

/** Safely cast Supabase select results to ContentListItem[]. */
function asContentListItems(data: unknown): ContentListItem[] {
  if (!Array.isArray(data)) return [];
  return data as ContentListItem[];
}

export interface UseBrowseDataReturn {
  items: ContentListItem[];
  totalCount: number | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  qualityFlaggedIds: Set<string>;
  sentinelCallbackRef: RefCallback<HTMLDivElement>;
  /** Re-run the initial fetch (e.g. after an upload or mutation) */
  refreshData: () => void;
  /** Expose filters passthrough so the component doesn't need a separate useBrowseFilters() call */
  filters: ReturnType<typeof useBrowseFilters>['filters'];
  activeFilterCount: ReturnType<typeof useBrowseFilters>['activeFilterCount'];
  setFilters: ReturnType<typeof useBrowseFilters>['setFilters'];
}

export function useBrowseData(): UseBrowseDataReturn {
  const supabase = createClient();
  const { filters, activeFilterCount, setFilters } = useBrowseFilters();

  // Data state
  const [items, setItems] = useState<ContentListItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);

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

  // Resolve entity filter to matching content_item IDs
  const resolveEntityIds = useCallback(async (): Promise<string[] | null> => {
    if (!filters.entity) return null;
    const { data, error } = await supabase
      .from('entity_mentions')
      .select('content_item_id')
      .eq('canonical_name', filters.entity);
    if (error) {
      console.error('Entity filter failed:', error);
      return null;
    }
    // Deduplicate content_item_ids
    return [...new Set((data ?? []).map((row: { content_item_id: string }) => row.content_item_id))];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [filters.entity]);

  // Build the Supabase query with filters and cursor-based pagination
  const buildQuery = useCallback(
    (
      cursorValue: string | null,
      isInitial: boolean,
      keywordMatchIds?: string[] | null,
      projectMatchIds?: string[] | null,
      qualityIssueIds?: string[] | null,
      entityMatchIds?: string[] | null,
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

      if (filters.starred) {
        query = query.eq('metadata->>starred', 'true');
      }

      if (filters.priority?.length) {
        query = query.in('priority', filters.priority);
      }

      if (filters.user_tags?.length) {
        query = query.overlaps('user_tags', filters.user_tags);
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
      }

      query = query.limit(PAGE_SIZE);

      return query;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
    [filters],
  );

  // Fetch initial data when filters change — reset cursor
  useEffect(() => {
    const currentRequestId = ++requestIdRef.current;

    const fetchData = async () => {
      setIsLoading(true);
      setItems([]);
      setCursor(null);

      // Resolve keyword + project + quality issue + entity filters via server-side lookups
      const [keywordIds, projectIds, qualityIds, entityIds] = await Promise.all([
        resolveKeywordIds(),
        resolveWorkspaceIds(),
        resolveQualityIssueIds(),
        resolveEntityIds(),
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

      const { data, count, error } = await buildQuery(null, true, keywordIds, projectIds, qualityIds, entityIds);

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

      // Set cursor from last item
      if (fetchedItems.length > 0) {
        const lastItem = fetchedItems[fetchedItems.length - 1];
        const sort = filters.sort ?? 'captured_date';
        setCursor(getCursorFromItem(lastItem, sort));
      }

      setIsLoading(false);
    };

    fetchData();
  }, [buildQuery, resolveKeywordIds, resolveWorkspaceIds, resolveQualityIssueIds, resolveEntityIds, filters.sort, refreshCounter]);

  // Load more using cursor
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !cursor) return;

    setIsLoadingMore(true);

    const [keywordIds, projectIds, qualityIds, entityIds] = await Promise.all([
      resolveKeywordIds(),
      resolveWorkspaceIds(),
      resolveQualityIssueIds(),
      resolveEntityIds(),
    ]);
    const { data, error } = await buildQuery(cursor, false, keywordIds, projectIds, qualityIds, entityIds);

    if (error) {
      console.error('Failed to load more items:', error);
      setIsLoadingMore(false);
      return;
    }

    const newItems = asContentListItems(data);
    setItems((prev) => [...prev, ...newItems]);
    setHasMore(newItems.length >= PAGE_SIZE);

    // Update cursor from last item of new batch
    if (newItems.length > 0) {
      const lastItem = newItems[newItems.length - 1];
      const sort = filters.sort ?? 'captured_date';
      setCursor(getCursorFromItem(lastItem, sort));
    }

    setIsLoadingMore(false);
  }, [
    isLoadingMore,
    hasMore,
    cursor,
    buildQuery,
    resolveKeywordIds,
    resolveWorkspaceIds,
    resolveQualityIssueIds,
    resolveEntityIds,
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

  return {
    items,
    totalCount,
    isLoading,
    isLoadingMore,
    hasMore,
    qualityFlaggedIds,
    sentinelCallbackRef,
    refreshData,
    filters,
    activeFilterCount,
    setFilters,
  };
}
