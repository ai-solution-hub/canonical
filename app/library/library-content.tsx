'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { escapePostgrestValue } from '@/lib/supabase/escape';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  Filter,
  Loader2,
  Tag,
  FolderPlus,
  SlidersHorizontal,
  BookOpen,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { createClient } from '@/lib/supabase/client';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { useUserRole } from '@/hooks/use-user-role';
import { CONTENT_LIST_COLUMNS, type ContentListItem } from '@/types/content';

import { useLibraryFilters, type LibraryFilters, type GroupBy } from '@/hooks/use-library-filters';
import { useLibraryBulkActions } from '@/hooks/use-library-bulk-actions';
import { QARow } from '@/components/qa-row';
import { BulkActionToolbar } from '@/components/bulk-action-toolbar';
import { CollapsibleGroup, groupItems } from '@/components/collapsible-group';

// ---------------------------------------------------------------------------
// VirtualisedQAList — renders the flat Q&A list with window-based virtualisation
// ---------------------------------------------------------------------------

const ROW_GAP = 8; // matches space-y-2 (0.5rem = 8px)
const ESTIMATED_ROW_HEIGHT = 72; // collapsed row ~72px including border + padding

function VirtualisedQAList({
  items,
  selectedIds,
  onToggleSelect,
}: {
  items: ContentListItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const virtualiser = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 5,
    gap: ROW_GAP,
  });

  const virtualItems = virtualiser.getVirtualItems();

  if (items.length === 0) return null;

  return (
    <div
      ref={listRef}
      style={{ height: `${virtualiser.getTotalSize()}px`, position: 'relative' }}
    >
      {virtualItems.map((virtualRow) => {
        const item = items[virtualRow.index];
        return (
          <div
            key={item.id}
            data-index={virtualRow.index}
            ref={virtualiser.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <QARow
              item={item}
              selected={selectedIds.has(item.id)}
              onToggleSelect={onToggleSelect}
            />
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LibraryContent
// ---------------------------------------------------------------------------

export function LibraryContent() {
  const supabase = createClient();
  const { filters, setFilters, clearFilters, activeCount, groupBy, setGroupBy } = useLibraryFilters();
  const { domains } = useTaxonomy();
  const { canAdmin } = useUserRole();

  const [items, setItems] = useState<ContentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sourceFiles, setSourceFiles] = useState<string[]>([]);

  // Trigger for re-fetching data after bulk operations
  const [fetchTrigger, setFetchTrigger] = useState(0);

  // Bulk actions hook
  const bulk = useLibraryBulkActions({
    items,
    filterDeps: [filters.domain, filters.source_file, filters.variant, filters.search, filters.freshness, filters.verified],
    onRefetch: useCallback(() => setFetchTrigger((prev) => prev + 1), []),
  });

  // Fetch Q&A pairs
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);

      let query = supabase
        .from('content_items')
        .select(CONTENT_LIST_COLUMNS.trim())
        .eq('content_type', 'q_a_pair')
        .or('governance_review_status.is.null,governance_review_status.neq.draft')
        .order('primary_domain', { ascending: true })
        .order('title', { ascending: true });

      if (filters.domain) {
        query = query.eq('primary_domain', filters.domain);
      }

      if (filters.source_file) {
        query = query.eq('metadata->>source_file', filters.source_file);
      }

      if (filters.variant === 'both') {
        query = query.not('answer_standard', 'is', null).not('answer_advanced', 'is', null);
      } else if (filters.variant === 'standard_only') {
        query = query.not('answer_standard', 'is', null).is('answer_advanced', null);
      } else if (filters.variant === 'advanced_only') {
        query = query.is('answer_standard', null).not('answer_advanced', 'is', null);
      } else if (filters.variant === 'neither') {
        query = query.is('answer_standard', null).is('answer_advanced', null);
      }

      if (filters.freshness) {
        query = query.eq('freshness', filters.freshness);
      }

      if (filters.verified === 'verified') {
        query = query.not('verified_at', 'is', null);
      } else if (filters.verified === 'unverified') {
        query = query.is('verified_at', null);
      }

      if (filters.search) {
        const escaped = escapePostgrestValue(filters.search);
        query = query.or(
          `title.ilike.%${escaped}%,content.ilike.%${escaped}%`,
        );
      }

      const { data, error } = await query;

      if (error) {
        console.error('Failed to fetch Q&A pairs:', error);
        setIsLoading(false);
        return;
      }

      const fetched = Array.isArray(data) ? (data as unknown as ContentListItem[]) : [];
      setItems(fetched);
      setIsLoading(false);
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.domain, filters.source_file, filters.variant, filters.search, filters.freshness, filters.verified, fetchTrigger]);

  // Fetch distinct source files for filter dropdown
  useEffect(() => {
    const fetchSources = async () => {
      const { data } = await supabase
        .from('content_items')
        .select('metadata->>source_file')
        .eq('content_type', 'q_a_pair')
        .not('metadata->>source_file', 'is', null)
        .not('metadata->>source_file', 'eq', '');

      if (data) {
        const unique = [
          ...new Set(
            (data as Array<{ source_file: string }>).map((r) => r.source_file).filter(Boolean),
          ),
        ].sort();
        setSourceFiles(unique);
      }
    };
    fetchSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stats
  const standardCount = items.filter((i) => i.answer_standard).length;
  const advancedCount = items.filter((i) => i.answer_advanced).length;

  // Count of active secondary filters (source, variant, verified, grouping)
  const secondaryFilterCount = useMemo(
    () =>
      [
        filters.source_file,
        filters.variant,
        filters.verified,
        groupBy !== 'none' ? groupBy : undefined,
      ].filter(Boolean).length,
    [filters.source_file, filters.variant, filters.verified, groupBy],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Q&A Library</h1>
          <p className="mt-0.5 text-sm text-muted-foreground" aria-live="polite">
            {isLoading ? (
              <span className="inline-block h-4 w-48 animate-pulse rounded bg-accent align-middle" />
            ) : (
              <>
                {items.length} Q&A pair{items.length !== 1 ? 's' : ''}
                {standardCount > 0 && (
                  <span> · {standardCount} standard</span>
                )}
                {advancedCount > 0 && (
                  <span> · {advancedCount} advanced</span>
                )}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Search + Primary Filters */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search questions and answers..."
            value={filters.search ?? ''}
            onChange={(e) => setFilters({ search: e.target.value || undefined })}
            className="h-9 pl-9"
            aria-label="Search Q&A pairs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.domain ?? '__all__'}
            onValueChange={(v) => setFilters({ domain: v === '__all__' ? undefined : v })}
          >
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <SelectValue placeholder="All domains" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All domains</SelectItem>
              {domains.map((d) => (
                <SelectItem key={d.name} value={d.name}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.freshness ?? 'all'}
            onValueChange={(v) =>
              setFilters({ freshness: v === 'all' ? undefined : (v as LibraryFilters['freshness']) })
            }
          >
            <SelectTrigger className="h-9 w-[130px] text-xs">
              <SelectValue placeholder="All freshness" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All freshness</SelectItem>
              <SelectItem value="fresh">Fresh</SelectItem>
              <SelectItem value="aging">Ageing</SelectItem>
              <SelectItem value="stale">Stale</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
            </SelectContent>
          </Select>

          {/* Secondary filters popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <SlidersHorizontal className="size-3.5" />
                More filters
                {secondaryFilterCount > 0 && (
                  <span className="ml-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-medium text-primary-foreground">
                    {secondaryFilterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="min-w-[280px] space-y-4">
              <h3 className="text-sm font-medium text-foreground">Additional Filters</h3>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Source</label>
                  <Select
                    value={filters.source_file ?? '__all__'}
                    onValueChange={(v) => setFilters({ source_file: v === '__all__' ? undefined : v })}
                  >
                    <SelectTrigger className="h-9 w-full text-xs">
                      <SelectValue placeholder="All sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All sources</SelectItem>
                      {sourceFiles.map((f) => (
                        <SelectItem key={f} value={f}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Variant</label>
                  <Select
                    value={filters.variant ?? 'all'}
                    onValueChange={(v) =>
                      setFilters({ variant: v === 'all' ? undefined : (v as LibraryFilters['variant']) })
                    }
                  >
                    <SelectTrigger className="h-9 w-full text-xs">
                      <SelectValue placeholder="All variants" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All variants</SelectItem>
                      <SelectItem value="both">Standard + Advanced</SelectItem>
                      <SelectItem value="standard_only">Standard only</SelectItem>
                      <SelectItem value="advanced_only">Advanced only</SelectItem>
                      <SelectItem value="neither">No answer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Verified status</label>
                  <Select
                    value={filters.verified ?? 'all'}
                    onValueChange={(v) =>
                      setFilters({ verified: v === 'all' ? undefined : (v as LibraryFilters['verified']) })
                    }
                  >
                    <SelectTrigger className="h-9 w-full text-xs">
                      <SelectValue placeholder="All status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All status</SelectItem>
                      <SelectItem value="verified">Verified</SelectItem>
                      <SelectItem value="unverified">Unverified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Grouping</label>
                  <Select
                    value={groupBy}
                    onValueChange={(v) => setGroupBy(v as GroupBy)}
                  >
                    <SelectTrigger className="h-9 w-full text-xs">
                      <SelectValue placeholder="No grouping" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No grouping</SelectItem>
                      <SelectItem value="source">By source document</SelectItem>
                      <SelectItem value="domain">By domain</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {secondaryFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full text-xs"
                  onClick={() => {
                    setFilters({ source_file: undefined, variant: undefined, verified: undefined });
                    setGroupBy('none');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </PopoverContent>
          </Popover>

          {activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 text-xs">
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Q&A List */}
      <div
        className="mt-6 space-y-2"
        onKeyDown={(e) => {
          if (e.key === 'c' || e.key === 'C') {
            const focused = document.activeElement as HTMLElement;
            if (!focused?.hasAttribute('data-qa-row')) return;
            const copyBtn = focused.querySelector<HTMLButtonElement>('[data-copy-answer]');
            if (copyBtn) {
              copyBtn.click();
              e.preventDefault();
            }
            return;
          }
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          const rows = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>('[data-qa-row]'),
          );
          if (rows.length === 0) return;
          const idx = rows.indexOf(document.activeElement as HTMLElement);
          let next: number;
          if (e.key === 'ArrowDown') {
            next = idx < rows.length - 1 ? idx + 1 : 0;
          } else {
            next = idx > 0 ? idx - 1 : rows.length - 1;
          }
          rows[next].focus();
          e.preventDefault();
        }}
      >
        {/* Bulk action toolbar */}
        <BulkActionToolbar
          selectedCount={bulk.selectedIds.size}
          isAdmin={canAdmin}
          bulkOperating={bulk.bulkOperating}
          bulkProgress={bulk.bulkProgress}
          onBulkReclassify={bulk.handleBulkReclassify}
          onBulkTag={bulk.handleBulkTagOpen}
          onBulkAssign={bulk.handleBulkAssignOpen}
          onBulkVerify={bulk.handleBulkVerify}
          onBulkDelete={bulk.handleBulkDelete}
          onClearSelection={bulk.clearSelection}
        />

        {/* Select all header */}
        {!isLoading && items.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-muted/30 border border-border/50">
            <div
              className="flex items-center justify-center min-w-[44px] min-h-[44px] -m-2.5"
              role="presentation"
            >
              <Checkbox
                checked={items.length > 0 && bulk.selectedIds.size === items.length}
                onCheckedChange={bulk.toggleSelectAll}
                aria-label={
                  bulk.selectedIds.size === items.length
                    ? 'Deselect all Q&A pairs'
                    : 'Select all Q&A pairs'
                }
                className="cursor-pointer"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {bulk.selectedIds.size === items.length && items.length > 0
                ? `All ${items.length} selected`
                : 'Select all'}
            </span>
          </div>
        )}

        {isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
            >
              <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-accent" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            {activeCount > 0 ? (
              <Filter className="size-8 text-muted-foreground/50" aria-hidden="true" />
            ) : (
              <BookOpen className="size-8 text-muted-foreground/50" aria-hidden="true" />
            )}
            <h3 className="text-base font-medium text-foreground">
              {activeCount > 0 ? 'No matching Q&A pairs' : 'No Q&A pairs yet'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {activeCount > 0
                ? 'Try adjusting your filters to see more results.'
                : 'Import Q&A pairs from client documents to build your library.'}
            </p>
            {activeCount > 0 && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        ) : groupBy !== 'none' ? (
          <div className="space-y-3">
            {(() => {
              const groups = groupItems(items, groupBy);
              return (
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {groups.size} {groups.size === 1 ? 'group' : 'groups'}, {items.length} total {items.length === 1 ? 'item' : 'items'}
                </p>
              );
            })()}
            {Array.from(groupItems(items, groupBy).entries()).map(([groupName, groupedItems]) => (
              <CollapsibleGroup key={groupName} label={groupName} count={groupedItems.length}>
                {groupedItems.map((item) => (
                  <QARow
                    key={item.id}
                    item={item}
                    selected={bulk.selectedIds.has(item.id)}
                    onToggleSelect={bulk.toggleSelect}
                  />
                ))}
              </CollapsibleGroup>
            ))}
          </div>
        ) : (
          <VirtualisedQAList
            items={items}
            selectedIds={bulk.selectedIds}
            onToggleSelect={bulk.toggleSelect}
          />
        )}
      </div>

      {/* Tag dialog */}
      <Dialog open={bulk.tagDialogOpen} onOpenChange={bulk.setTagDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add tags to {bulk.selectedIds.size} item{bulk.selectedIds.size !== 1 ? 's' : ''}</DialogTitle>
            <DialogDescription>
              Enter comma-separated tags. They will be merged with any existing tags on each item.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="e.g. important, needs-review, client-facing"
            value={bulk.tagInput}
            onChange={(e) => bulk.setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                bulk.handleBulkTagConfirm();
              }
            }}
            aria-label="Tags (comma-separated)"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => bulk.setTagDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={bulk.handleBulkTagConfirm} disabled={!bulk.tagInput.trim()}>
              <Tag className="mr-1.5 size-3.5" />
              Apply tags
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign to workspace dialog */}
      <Dialog open={bulk.assignDialogOpen} onOpenChange={bulk.setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {bulk.selectedIds.size} item{bulk.selectedIds.size !== 1 ? 's' : ''} to workspace</DialogTitle>
            <DialogDescription>
              Select a workspace to assign the selected Q&A pairs to.
            </DialogDescription>
          </DialogHeader>
          {bulk.workspacesLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading workspaces...
            </div>
          ) : (
            <Select value={bulk.selectedWorkspaceId} onValueChange={bulk.setSelectedWorkspaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {bulk.workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                    <span className="ml-2 text-xs text-muted-foreground">({ws.type})</span>
                  </SelectItem>
                ))}
                {bulk.workspaces.length === 0 && (
                  <SelectItem value="__none__" disabled>
                    No workspaces found
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => bulk.setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={bulk.handleBulkAssignConfirm} disabled={!bulk.selectedWorkspaceId || bulk.workspacesLoading}>
              <FolderPlus className="mr-1.5 size-3.5" />
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
