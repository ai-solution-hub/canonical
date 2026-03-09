'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Upload, Plus, Loader2 } from 'lucide-react';
import { ContentGrid } from '@/components/content-grid';
import { ContentList } from '@/components/content-list';
import { FilterPanel } from '@/components/filter-panel';
import { FilterBadges } from '@/components/filter-badges';
import { FilterBar, type SortOption } from '@/components/filter-bar';
import { BulkActions } from '@/components/bulk-actions';
import { LoadingSkeleton, EmptyState } from '@/components/browse-states';
import dynamic from 'next/dynamic';

const FileUploadDialog = dynamic(
  () => import('@/components/file-upload-dialog').then((mod) => mod.FileUploadDialog),
  { ssr: false },
);
import { Button } from '@/components/ui/button';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { useViewMode } from '@/hooks/use-view-mode';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useUserRole } from '@/hooks/use-user-role';
import { useBrowseData } from '@/hooks/use-browse-data';
import {
  getSortOptionFromFilters,
  getSortFiltersFromOption,
} from '@/lib/browse-helpers';

export function BrowseContent() {
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

  // Data fetching via extracted hook
  const {
    items,
    totalCount,
    isLoading,
    isLoadingMore,
    hasMore,
    qualityFlaggedIds,
    sentinelCallbackRef,
    filters,
    activeFilterCount,
    setFilters,
  } = useBrowseData();

  // Trigger lazy loading of read marks counts for this page
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  // UI-only state
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const { viewMode, setViewMode } = useViewMode('kb-browse-view');
  const [hideThumbnails, setHideThumbnails] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('kb-hide-thumbnails') === 'true';
    }
    return false;
  });

  // Reset activeIndex when items change (new filter/sort/data)
  useEffect(() => {
    setActiveIndex(-1);
  }, [items]);

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
            onViewChange={setViewMode}
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

      {/* Infinite scroll sentinel + status */}
      {!isLoading && items.length > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2">
          {hasMore && (
            <div ref={sentinelCallbackRef} aria-hidden="true" className="h-px w-full" />
          )}
          {isLoadingMore && (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          )}
          <p className="text-sm text-muted-foreground">
            Showing {displayItems.length} of {totalCount?.toLocaleString('en-GB') ?? '...'} items
          </p>
        </div>
      )}

      <FilterPanel open={filterPanelOpen} onOpenChange={setFilterPanelOpen} />
      <FileUploadDialog open={showUpload} onOpenChange={setShowUpload} />
    </div>
  );
}
