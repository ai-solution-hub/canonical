'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Upload, Plus } from 'lucide-react';
import { ContentGrid } from '@/components/content-grid';
import { ContentList } from '@/components/content-list';
import { FilterPanel } from '@/components/filter-panel';
import { FilterBadges } from '@/components/filter-badges';
import { FilterBar, type ViewMode, type SortOption } from '@/components/filter-bar';
import { BulkActions } from '@/components/bulk-actions';
import { PaginationControls } from '@/components/pagination-controls';
import { LoadingSkeleton, EmptyState } from '@/components/browse-states';
import dynamic from 'next/dynamic';

const FileUploadDialog = dynamic(
  () => import('@/components/file-upload-dialog').then((mod) => mod.FileUploadDialog),
  { ssr: false },
);
import { Button } from '@/components/ui/button';
import { useBrowseFilters } from '@/hooks/use-browse-filters';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useUserRole } from '@/hooks/use-user-role';
import { createClient } from '@/lib/supabase/client';
import {
  getSortOptionFromFilters,
  getSortFiltersFromOption,
  getCursorFromItem,
} from '@/lib/browse-helpers';
import { CONTENT_LIST_COLUMNS, type ContentListItem } from '@/types/content';

const PAGE_SIZE = 48;

/** Safely cast Supabase select results to ContentListItem[]. */
function asContentListItems(data: unknown): ContentListItem[] {
  if (!Array.isArray(data)) return [];
  return data as ContentListItem[];
}

export function BrowseContent() {
  const supabase = createClient();
  const { filters, activeFilterCount, setFilters } = useBrowseFilters();
  const router = useRouter();
  const { canEdit } = useUserRole();
  const {
    isRead,
    readItemIds,
    markBulkRead,
    isLoaded: readMarksLoaded,
    loadReadMarks,
    checkReadStatus,
  } = useReadMarks();

  // Trigger lazy loading of read marks counts for this page
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  // Fetch quality-flagged item IDs for browse card indicators
  const [qualityFlaggedIds, setQualityFlaggedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const fetchQualityFlags = async () => {
      const { data } = await supabase.rpc('get_items_with_quality_flags');
      if (data) setQualityFlaggedIds(new Set(data as string[]));
    };
    fetchQualityFlags();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, []);

  const [items, setItems] = useState<ContentListItem[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('kb-browse-view') as ViewMode) || 'grid';
    }
    return 'grid';
  });
  const [hideThumbnails, setHideThumbnails] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('kb-hide-thumbnails') === 'true';
    }
    return false;
  });

  // Track the current request to avoid stale responses
  const requestIdRef = useRef(0);

  // Reset activeIndex when items change (new filter/sort/data)
  const prevItemsRef = useRef(items);
  if (prevItemsRef.current !== items) {
    prevItemsRef.current = items;
    if (activeIndex !== -1) {
      setActiveIndex(-1);
    }
  }

  // Keyboard shortcut callbacks
  const handleFocusSearch = useCallback(() => {
    const searchInput = document.querySelector<HTMLInputElement>(
      'header input[type="search"]',
    );
    searchInput?.focus();
  }, []);

  const handleNavigate = useCallback(
    (direction: 'up' | 'down' | 'first' | 'last') => {
      if (items.length === 0) return;

      setActiveIndex((prev) => {
        switch (direction) {
          case 'down':
            return Math.min(prev + 1, items.length - 1);
          case 'up':
            return Math.max(prev - 1, 0);
          case 'first':
            return 0;
          case 'last':
            return items.length - 1;
        }
      });
    },
    [items.length],
  );

  const handleSelect = useCallback(() => {
    if (activeIndex >= 0 && activeIndex < items.length) {
      router.push(`/item/${items[activeIndex].id}`);
    }
  }, [activeIndex, items, router]);

  useKeyboardShortcuts({
    onFocusSearch: handleFocusSearch,
    onNavigate: handleNavigate,
    onSelect: handleSelect,
    onGoToReview: useCallback(() => router.push('/review'), [router]),
    enabled: true,
  });

  const sortOption = getSortOptionFromFilters(filters.sort, filters.order);

  // Persist view mode
  const handleViewChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem('kb-browse-view', mode);
  }, []);

  const handleSortChange = useCallback(
    (value: SortOption) => {
      setFilters(getSortFiltersFromOption(value));
    },
    [setFilters],
  );

  // Check read status for visible items when items change
  useEffect(() => {
    if (items.length > 0) {
      checkReadStatus(items.map((item) => item.id));
    }
  }, [items, checkReadStatus]);

  // Filter displayed items by unread status (client-side)
  const displayItems =
    showUnreadOnly && readMarksLoaded
      ? items.filter((item) => !isRead(item.id))
      : items;

  // Multi-select handlers
  const toggleSelectItem = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }, []);

  const handleMarkSelectedRead = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await markBulkRead(ids, 'bulk');
    toast.success(
      `Marked ${ids.length} item${ids.length !== 1 ? 's' : ''} as read`,
    );
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }, [selectedIds, markBulkRead]);

  const handleCancelMultiSelect = useCallback(() => {
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }, []);

  const handleToggleMultiSelect = useCallback(() => {
    if (multiSelectMode) {
      handleCancelMultiSelect();
    } else {
      setMultiSelectMode(true);
    }
  }, [multiSelectMode, handleCancelMultiSelect]);

  const handleToggleUnreadOnly = useCallback(() => {
    setShowUnreadOnly((prev) => !prev);
  }, []);

  const handleToggleThumbnails = useCallback(() => {
    const next = !hideThumbnails;
    setHideThumbnails(next);
    localStorage.setItem('kb-hide-thumbnails', String(next));
  }, [hideThumbnails]);

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

  // Resolve project filter to matching content_item IDs
  const resolveProjectIds = useCallback(async (): Promise<string[] | null> => {
    if (!filters.project) return null;
    const { data, error } = await supabase
      .from('content_item_projects')
      .select('content_item_id')
      .eq('project_id', filters.project);
    if (error) {
      console.error('Project filter failed:', error);
      return null;
    }
    return (data ?? []).map((row: { content_item_id: string }) => row.content_item_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase is a stable singleton from createClient()
  }, [filters.project]);

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

  // Build the Supabase query with filters and cursor-based pagination
  const buildQuery = useCallback(
    (
      cursorValue: string | null,
      isInitial: boolean,
      keywordMatchIds?: string[] | null,
      projectMatchIds?: string[] | null,
      qualityIssueIds?: string[] | null,
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

      if (idSets.length > 0) {
        let intersection = idSets[0];
        for (let i = 1; i < idSets.length; i++) {
          const currentSet = new Set(idSets[i]);
          intersection = intersection.filter((id) => currentSet.has(id));
        }
        query = query.in('id', intersection.length ? intersection : ['__none__']);
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
          query = query.or(
            `primary_domain.gt.${curDomain},` +
              `and(primary_domain.eq.${curDomain},captured_date.lt.${curDate}),` +
              `and(primary_domain.eq.${curDomain},captured_date.eq.${curDate},id.gt.${curId})`,
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
          query = query.or(
            `classification_confidence.lt.${curConf},` +
              `and(classification_confidence.eq.${curConf},id.gt.${curId})`,
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

      // Resolve keyword + project + quality issue filters via server-side lookups
      const [keywordIds, projectIds, qualityIds] = await Promise.all([
        resolveKeywordIds(),
        resolveProjectIds(),
        resolveQualityIssueIds(),
      ]);
      if (
        (keywordIds !== null && keywordIds.length === 0) ||
        (projectIds !== null && projectIds.length === 0) ||
        (qualityIds !== null && qualityIds.length === 0)
      ) {
        // Filter was specified but nothing matched
        if (currentRequestId !== requestIdRef.current) return;
        setItems([]);
        setTotalCount(0);
        setHasMore(false);
        setIsLoading(false);
        return;
      }

      const { data, count, error } = await buildQuery(null, true, keywordIds, projectIds, qualityIds);

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
  }, [buildQuery, resolveKeywordIds, resolveProjectIds, resolveQualityIssueIds, filters.sort]);

  // Load more using cursor
  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !cursor) return;

    setIsLoadingMore(true);

    const [keywordIds, projectIds, qualityIds] = await Promise.all([
      resolveKeywordIds(),
      resolveProjectIds(),
      resolveQualityIssueIds(),
    ]);
    const { data, error } = await buildQuery(cursor, false, keywordIds, projectIds, qualityIds);

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
    resolveProjectIds,
    resolveQualityIssueIds,
    filters.sort,
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Browse Content
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isLoading ? (
              <span className="inline-block h-4 w-32 animate-pulse rounded bg-accent align-middle" />
            ) : (
              <>
                {totalCount !== null
                  ? `${totalCount.toLocaleString('en-GB')} item${totalCount !== 1 ? 's' : ''}`
                  : 'Loading...'}
                {activeFilterCount > 0 && (
                  <span className="text-muted-foreground"> (filtered)</span>
                )}
              </>
            )}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Button
                variant="default"
                size="sm"
                asChild
                className="gap-1.5"
              >
                <Link href="/item/new">
                  <Plus className="size-3.5" />
                  New Content
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowUpload(true)}
                className="gap-1.5"
              >
                <Upload className="size-3.5" />
                Upload
              </Button>
            </>
          )}
          <FilterBar
            showUnreadOnly={showUnreadOnly}
            onToggleUnreadOnly={handleToggleUnreadOnly}
            multiSelectMode={multiSelectMode}
            onToggleMultiSelect={handleToggleMultiSelect}
            sortOption={sortOption}
            onSortChange={handleSortChange}
            viewMode={viewMode}
            onViewChange={handleViewChange}
            hideThumbnails={hideThumbnails}
            onToggleThumbnails={handleToggleThumbnails}
            activeFilterCount={activeFilterCount}
            onOpenFilters={() => setFilterPanelOpen(true)}
          />
        </div>
      </div>

      <div className="mt-4"><FilterBadges /></div>

      {multiSelectMode && selectedIds.size > 0 && (
        <BulkActions
          selectedCount={selectedIds.size}
          onMarkSelectedRead={handleMarkSelectedRead}
          onCancel={handleCancelMultiSelect}
        />
      )}

      <div className="mt-6">
        {isLoading ? (
          <LoadingSkeleton viewMode={viewMode} />
        ) : displayItems.length === 0 ? (
          <EmptyState hasFilters={activeFilterCount > 0 || showUnreadOnly} />
        ) : (
          <AnimatePresence mode="wait">
            {viewMode === 'grid' ? (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <ContentGrid
                  items={displayItems}
                  activeIndex={activeIndex}
                  readItemIds={readMarksLoaded ? readItemIds : undefined}
                  qualityFlaggedIds={qualityFlaggedIds}
                  multiSelectMode={multiSelectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelectItem}
                  hideThumbnails={hideThumbnails}
                />
              </motion.div>
            ) : (
              <motion.div
                key="list"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <ContentList
                  items={displayItems}
                  activeIndex={activeIndex}
                  readItemIds={readMarksLoaded ? readItemIds : undefined}
                  qualityFlaggedIds={qualityFlaggedIds}
                  multiSelectMode={multiSelectMode}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelectItem}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {!isLoading && hasMore && items.length > 0 && (
        <PaginationControls
          itemCount={items.length}
          totalCount={totalCount}
          isLoadingMore={isLoadingMore}
          onLoadMore={handleLoadMore}
        />
      )}

      <FilterPanel open={filterPanelOpen} onOpenChange={setFilterPanelOpen} />
      <FileUploadDialog open={showUpload} onOpenChange={setShowUpload} />
    </div>
  );
}
