'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { toast } from 'sonner';
import { Upload, Plus, Loader2, Search, AlertCircle } from 'lucide-react';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { generateIngestDocumentPrompt } from '@/lib/claude-prompts';
import { ContentGrid } from '@/components/content/content-grid';
import { ContentList } from '@/components/content/content-list';
import { FilterPanel } from '@/components/browse/filter-panel';
import { FilterBadges } from '@/components/browse/filter-badges';
import { FilterBar, type SortOption } from '@/components/browse/filter-bar';
import { BulkActions } from '@/components/browse/bulk-actions';
import { LoadingSkeleton, EmptyState } from '@/components/browse/browse-states';
import { PresetBar } from '@/components/browse/preset-bar';
import { SavePresetDialog } from '@/components/browse/save-preset-dialog';
import { ManagePresetsDialog } from '@/components/browse/manage-presets-dialog';
import dynamic from 'next/dynamic';

const FileUploadDialog = dynamic(
  () => import('@/components/create-content/file-upload-dialog').then((mod) => mod.FileUploadDialog),
  { ssr: false },
);
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useKeyboardShortcuts } from '@/hooks/ui/use-keyboard-shortcuts';
import { useViewMode } from '@/hooks/ui/use-view-mode';
import { useReadMarks } from '@/contexts/read-marks-context';
import { useUserRole } from '@/hooks/use-user-role';
import { useBrowseData } from '@/hooks/browse/use-browse-data';
import type { OnOptimisticUpdate } from '@/hooks/review/use-quick-review';
import { useFilterPresets } from '@/hooks/browse/use-filter-presets';
import { useQuickAssign } from '@/hooks/use-quick-assign';
import { useDisplayNames } from '@/hooks/use-display-names';
import {
  getSortOptionFromFilters,
  getSortFiltersFromOption,
} from '@/lib/browse-helpers';

export function BrowseContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canEdit } = useUserRole();

  // Parse ?from_bid=<workspaceId> for contextual quick-assign shortcut
  const fromBidId = searchParams.get('from_bid') ?? undefined;
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
    freshnessCounts,
    sentinelCallbackRef,
    filters,
    activeFilterCount,
    setFilters,
    searchQuery,
    setSearchQuery,
    clearFilters,
    isSearchMode,
    searchError,
    updateItemLocally,
    updateQualityFlag,
  } = useBrowseData();

  // Filter presets
  const {
    presets,
    activePreset,
    applyPreset,
    savePreset,
    renamePreset,
    deletePreset,
    restorePreset,
    canSave: canSavePreset,
  } = useFilterPresets();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [manageDialogOpen, setManageDialogOpen] = useState(false);

  // Quick-assign: fetch active workspaces + batch load assignments (editor/admin only)
  const {
    activeWorkspaces,
    itemAssignments,
    toggleAssignment,
    loadAssignments,
  } = useQuickAssign();

  // Load workspace assignments when items change (only for editors)
  useEffect(() => {
    if (!canEdit || items.length === 0) return;
    loadAssignments(items.map((item) => item.id));
  }, [canEdit, items, loadAssignments]);

  // Trigger lazy loading of read marks counts for this page
  useEffect(() => { loadReadMarks(); }, [loadReadMarks]);

  // UI-only state
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const { viewMode, setViewMode } = useViewMode('kb-view-mode');
  const [hideThumbnails, setHideThumbnails] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('kb-hide-thumbnails') === 'true';
    }
    return false;
  });

  // Browse search input
  const browseSearchRef = useRef<HTMLInputElement>(null);
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery ?? '');

  // Sync local input when URL search query changes externally
  useEffect(() => {
    setLocalSearchQuery(searchQuery ?? '');
  }, [searchQuery]);

  const handleSearchSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = localSearchQuery.trim();
      if (trimmed) {
        setSearchQuery(trimmed);
      } else {
        setSearchQuery(undefined);
      }
    },
    [localSearchQuery, setSearchQuery],
  );

  // Reset activeIndex when items change (new filter/sort/data)
  useEffect(() => {
    setActiveIndex(-1);
  }, [items]);

  // Keyboard shortcut callbacks
  const handleFocusSearch = useCallback(() => {
    // Prefer the Browse page search input; fall back to header
    if (browseSearchRef.current) {
      browseSearchRef.current.focus();
      return;
    }
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

  // Resolve verifier display names for browse badges
  const verifierIds = displayItems
    .map((item) => item.verified_by)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const verifierNames = useDisplayNames(verifierIds);

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

  // Send to review bulk action state
  const [isSendingToReview, setIsSendingToReview] = useState(false);

  const handleSendToReview = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsSendingToReview(true);
    try {
      const res = await fetch('/api/items/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_ids: ids, status: 'pending' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Failed to send items for review');
      }
      const data = await res.json();
      toast.success(
        `${data.updated} item${data.updated !== 1 ? 's' : ''} sent for review`,
      );
      setSelectedIds(new Set());
      setMultiSelectMode(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to send items for review',
      );
    } finally {
      setIsSendingToReview(false);
    }
  }, [selectedIds]);

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

  // Quick review: bridge optimistic updates to local browse data
  const handleQuickReviewUpdate: OnOptimisticUpdate = useCallback(
    (itemId, updates) => {
      if ('verified_at' in updates) {
        updateItemLocally(itemId, { verified_at: updates.verified_at });
      }
      if ('hasQualityFlag' in updates) {
        updateQualityFlag(itemId, updates.hasQualityFlag ?? false);
      }
    },
    [updateItemLocally, updateQualityFlag],
  );

  return (
    <section aria-label={isSearchMode ? 'Browse and search results' : 'Browse content'} className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Browse Content
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isLoading ? (
              <span className="inline-block h-4 w-32 animate-pulse rounded bg-accent align-middle" />
            ) : isSearchMode ? (
              <>
                {totalCount !== null
                  ? `${totalCount.toLocaleString('en-GB')} result${totalCount !== 1 ? 's' : ''} for \u201c${searchQuery}\u201d`
                  : 'Searching...'}
              </>
            ) : (
              <>
                {totalCount !== null
                  ? `${totalCount.toLocaleString('en-GB')} item${totalCount !== 1 ? 's' : ''}`
                  : 'Loading...'}
                {freshnessCounts && (
                  <span className="text-muted-foreground">
                    {' \u2014 '}
                    <span className="text-freshness-fresh">{freshnessCounts.fresh} fresh</span>
                    {', '}
                    <span className="text-freshness-stale">{freshnessCounts.stale} stale</span>
                    {freshnessCounts.expired > 0 && (
                      <>
                        {', '}
                        <span className="text-freshness-expired">{freshnessCounts.expired} expired</span>
                      </>
                    )}
                  </span>
                )}
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
              <span className="hidden md:inline-flex">
                <ClaudePromptButton
                  prompt={generateIngestDocumentPrompt().prompt}
                  label="Open in Claude"
                  size="sm"
                />
              </span>
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
            hasSearchQuery={isSearchMode}
          />
        </div>
      </div>

      {/* Browse search bar */}
      <div className="mt-4">
        <form onSubmit={handleSearchSubmit} role="search" aria-label="Search content">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={browseSearchRef}
              type="search"
              placeholder="Search your knowledge..."
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              className="h-10 bg-white pl-10 pr-4 shadow-sm"
              aria-label="Search the knowledge base"
            />
          </div>
        </form>
      </div>

      {/* Search error */}
      {searchError && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          <AlertCircle className="size-4 shrink-0" />
          {searchError}
        </div>
      )}

      {/* Screen reader announcement for search results */}
      <div className="sr-only" aria-live="polite" role="status">
        {isSearchMode && !isLoading && totalCount !== null
          ? `${totalCount} result${totalCount !== 1 ? 's' : ''} for ${searchQuery}`
          : ''}
      </div>

      {/* Preset bar */}
      <div className="mt-4">
        <PresetBar
          presets={presets}
          activePresetId={activePreset?.id ?? null}
          onApplyPreset={applyPreset}
          onClearFilters={clearFilters}
          onSavePreset={() => setSaveDialogOpen(true)}
          onManagePresets={() => setManageDialogOpen(true)}
          canSave={canSavePreset && !activePreset}
        />
      </div>

      <div className="mt-3"><FilterBadges /></div>

      {multiSelectMode && selectedIds.size > 0 && (
        <BulkActions
          selectedCount={selectedIds.size}
          onMarkSelectedRead={handleMarkSelectedRead}
          onCancel={handleCancelMultiSelect}
          canSendToReview={canEdit}
          onSendToReview={handleSendToReview}
          isSendingToReview={isSendingToReview}
        />
      )}

      <div className="mt-6">
        {isLoading ? (
          <div role="status" aria-label="Loading content">
            <LoadingSkeleton viewMode={viewMode} />
          </div>
        ) : displayItems.length === 0 ? (
          isSearchMode ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Search className="size-8 text-muted-foreground" />
              <p className="text-lg font-medium text-foreground">No results found</p>
              <p className="text-sm text-muted-foreground">
                Try different search terms or adjust your filters.
              </p>
            </div>
          ) : (
            <EmptyState hasFilters={activeFilterCount > 0 || showUnreadOnly} />
          )
        ) : (
          <div className="transition-opacity duration-150">
            {viewMode === 'grid' ? (
              <ContentGrid
                items={displayItems}
                activeIndex={activeIndex}
                readItemIds={readMarksLoaded ? readItemIds : undefined}
                qualityFlaggedIds={qualityFlaggedIds}
                multiSelectMode={multiSelectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelectItem}
                hideThumbnails={hideThumbnails}
                canEdit={canEdit}
                simplifiedQuality={!canEdit}
                onQuickReviewUpdate={handleQuickReviewUpdate}
                activeWorkspaces={canEdit ? activeWorkspaces : undefined}
                itemAssignments={canEdit ? itemAssignments : undefined}
                onAssignmentChange={canEdit ? toggleAssignment : undefined}
                fromBidId={canEdit ? fromBidId : undefined}
                verifierNames={verifierNames}
              />
            ) : (
              <ContentList
                items={displayItems}
                activeIndex={activeIndex}
                readItemIds={readMarksLoaded ? readItemIds : undefined}
                qualityFlaggedIds={qualityFlaggedIds}
                multiSelectMode={multiSelectMode}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelectItem}
                canEdit={canEdit}
                onQuickReviewUpdate={handleQuickReviewUpdate}
                activeWorkspaces={canEdit ? activeWorkspaces : undefined}
                itemAssignments={canEdit ? itemAssignments : undefined}
                onAssignmentChange={canEdit ? toggleAssignment : undefined}
                fromBidId={canEdit ? fromBidId : undefined}
                verifierNames={verifierNames}
              />
            )}
          </div>
        )}
      </div>

      {/* Infinite scroll sentinel + status */}
      {!isLoading && items.length > 0 && (
        <div className="mt-8 flex flex-col items-center gap-2">
          {hasMore && !isSearchMode && (
            <div ref={sentinelCallbackRef} aria-hidden="true" className="h-px w-full" />
          )}
          {isLoadingMore && (
            <div role="status" aria-label="Loading more items">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Loading more items...</span>
            </div>
          )}
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {isSearchMode
              ? `Showing top ${displayItems.length} result${displayItems.length !== 1 ? 's' : ''}`
              : `Showing ${displayItems.length} of ${totalCount?.toLocaleString('en-GB') ?? '...'} items`}
          </p>
        </div>
      )}

      <FilterPanel open={filterPanelOpen} onOpenChange={setFilterPanelOpen} />
      <FileUploadDialog open={showUpload} onOpenChange={setShowUpload} />
      <SavePresetDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSave={(name) => savePreset(name)}
        activeFilterCount={activeFilterCount}
      />
      <ManagePresetsDialog
        open={manageDialogOpen}
        onOpenChange={setManageDialogOpen}
        presets={presets}
        onRename={renamePreset}
        onDelete={deletePreset}
        onRestore={restorePreset}
      />
    </section>
  );
}
