'use client';

import { useMemo, useRef } from 'react';
import Link from 'next/link';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  Search,
  Filter,
  SlidersHorizontal,
  BookOpen,
  ArrowRight,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useTaxonomy } from '@/contexts/taxonomy-context';
import { useUserRole } from '@/hooks/use-user-role';
import type { ContentListItem } from '@/types/content';

import {
  useLibraryFilters,
  type LibraryFilters,
  type GroupBy,
} from '@/hooks/browse/use-library-filters';
import { useLibraryData } from '@/hooks/use-library-data';
import { useLibraryBulkActions } from '@/hooks/use-library-bulk-actions';
import { QARow } from '@/components/qa/qa-row';
import { BulkActionToolbar } from '@/components/browse/bulk-action-toolbar';
import {
  CollapsibleGroup,
  groupItems,
} from '@/components/shell/collapsible-group';
import { EmptyState } from '@/components/empty-state/empty-state';

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
      style={{
        height: `${virtualiser.getTotalSize()}px`,
        position: 'relative',
      }}
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
  const {
    filters,
    setFilters,
    clearFilters,
    activeCount,
    groupBy,
    setGroupBy,
  } = useLibraryFilters();
  const { domains } = useTaxonomy();
  const { canEdit } = useUserRole();

  // Data fetching via TanStack Query
  const { items, isLoading, sourceFiles } = useLibraryData(filters);

  // Bulk actions hook
  const bulk = useLibraryBulkActions({
    items,
    filterDeps: [
      filters.domain,
      filters.source_file,
      filters.variant,
      filters.search,
      filters.freshness,
      filters.verified,
    ],
  });

  // Stats
  const standardCount = items.filter((i) => i.answer_standard).length;
  const advancedCount = items.filter((i) => i.answer_advanced).length;
  const verifiedCount = items.filter((i) => i.verified_at).length;

  // Memoised grouped items (avoids recomputing on every render)
  const groupedItems = useMemo(
    () => (groupBy !== 'none' ? groupItems(items, groupBy) : null),
    [items, groupBy],
  );

  // Count of active secondary filters (source, variant, grouping)
  const secondaryFilterCount = useMemo(
    () =>
      [
        filters.source_file,
        filters.variant,
        groupBy !== 'none' ? groupBy : undefined,
      ].filter(Boolean).length,
    [filters.source_file, filters.variant, groupBy],
  );

  return (
    <section
      aria-label="Q&A Library"
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
    >
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Q&A Library</h1>
          <p
            className="mt-0.5 text-sm text-muted-foreground"
            aria-live="polite"
          >
            {isLoading ? (
              <span className="inline-block h-4 w-48 animate-pulse rounded bg-accent align-middle" />
            ) : (
              <>
                {items.length} Q&A pair{items.length !== 1 ? 's' : ''}
                {standardCount > 0 && (
                  <span>
                    <span aria-hidden="true"> · </span>
                    {standardCount} standard
                  </span>
                )}
                {advancedCount > 0 && (
                  <span>
                    <span aria-hidden="true"> · </span>
                    {advancedCount} advanced
                  </span>
                )}
                {verifiedCount > 0 && (
                  <span>
                    <span aria-hidden="true"> · </span>
                    {verifiedCount} verified
                  </span>
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
            onChange={(e) =>
              setFilters({ search: e.target.value || undefined })
            }
            className="h-9 border bg-white pl-9 shadow-sm dark:bg-input/30"
            aria-label="Search Q&A pairs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.domain ?? '__all__'}
            onValueChange={(v) =>
              setFilters({ domain: v === '__all__' ? undefined : v })
            }
          >
            <SelectTrigger
              className="h-9 w-[160px] text-xs"
              aria-label="Filter by domain"
            >
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
              setFilters({
                freshness:
                  v === 'all' ? undefined : (v as LibraryFilters['freshness']),
              })
            }
          >
            <SelectTrigger
              className="h-9 w-[130px] text-xs"
              aria-label="Filter by freshness"
            >
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

          <Select
            value={filters.verified ?? 'all'}
            onValueChange={(v) =>
              setFilters({
                verified:
                  v === 'all' ? undefined : (v as LibraryFilters['verified']),
              })
            }
          >
            <SelectTrigger
              className="h-9 w-[130px] text-xs"
              aria-label="Filter by verified status"
            >
              <SelectValue placeholder="All status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="verified">Verified</SelectItem>
              <SelectItem value="unverified">Unverified</SelectItem>
            </SelectContent>
          </Select>

          {/* Secondary filters popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 text-xs"
              >
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
              <h3 className="text-sm font-medium text-foreground">
                Additional Filters
              </h3>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Source
                  </span>
                  <Select
                    value={filters.source_file ?? '__all__'}
                    onValueChange={(v) =>
                      setFilters({
                        source_file: v === '__all__' ? undefined : v,
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-full text-xs"
                      aria-label="Filter by source"
                    >
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
                  <span className="text-xs font-medium text-muted-foreground">
                    Variant
                  </span>
                  <Select
                    value={filters.variant ?? 'all'}
                    onValueChange={(v) =>
                      setFilters({
                        variant:
                          v === 'all'
                            ? undefined
                            : (v as LibraryFilters['variant']),
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-9 w-full text-xs"
                      aria-label="Filter by variant"
                    >
                      <SelectValue placeholder="All variants" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All variants</SelectItem>
                      <SelectItem value="both">Standard + Advanced</SelectItem>
                      <SelectItem value="standard_only">
                        Standard only
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Grouping
                  </span>
                  <Select
                    value={groupBy}
                    onValueChange={(v) => setGroupBy(v as GroupBy)}
                  >
                    <SelectTrigger
                      className="h-9 w-full text-xs"
                      aria-label="Group by"
                    >
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
                    setFilters({ source_file: undefined, variant: undefined });
                    setGroupBy('none');
                  }}
                >
                  Clear filters
                </Button>
              )}
            </PopoverContent>
          </Popover>

          {activeCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="h-9 text-xs"
            >
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Keyboard shortcut hints — directly below filters for discoverability */}
      {!isLoading && items.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
            C
          </kbd>{' '}
          to copy answer ·{' '}
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
            ↑
          </kbd>{' '}
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
            ↓
          </kbd>{' '}
          to navigate
        </p>
      )}

      {/* Q&A List */}
      <div
        className="mt-6 space-y-2"
        onKeyDown={(e) => {
          if (e.key === 'c' || e.key === 'C') {
            const focused = document.activeElement as HTMLElement;
            if (!focused?.hasAttribute('data-qa-row')) return;
            const copyBtn =
              focused.querySelector<HTMLButtonElement>('[data-copy-answer]');
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
          unverifiedSelectedCount={
            items.filter((i) => bulk.selectedIds.has(i.id) && !i.verified_at)
              .length
          }
          bulkOperating={bulk.bulkOperating}
          bulkProgress={bulk.bulkProgress}
          onBulkVerify={bulk.handleBulkVerify}
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
                checked={
                  items.length > 0 && bulk.selectedIds.size === items.length
                }
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
          <div role="status" aria-label="Loading library">
            <span className="sr-only">Loading library...</span>
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="flex flex-col gap-2 rounded-lg border bg-card p-4"
              >
                <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-accent" />
              </div>
            ))}
          </div>
        ) : items.length === 0 && activeCount > 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Filter
              className="size-8 text-muted-foreground/50"
              aria-hidden="true"
            />
            <h3 className="text-base font-medium text-foreground">
              No matching Q&A pairs
            </h3>
            <p className="text-sm text-muted-foreground">
              Try adjusting your filters to see more results.
            </p>
            <div className="flex flex-col items-center gap-2">
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
              {filters.search && (
                <Link
                  href={`/browse?q=${encodeURIComponent(filters.search)}`}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Try searching the full knowledge base
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="size-8" aria-hidden />}
            title="Your Q&A library is empty"
            description="Import Q&A pairs to build your bid response library."
            primaryCta={
              canEdit
                ? { label: 'Import Q&A pack', href: '/item/new?tab=batch' }
                : undefined
            }
            headingLevel="h3"
          />
        ) : groupedItems ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {groupedItems.size} {groupedItems.size === 1 ? 'group' : 'groups'}
              , {items.length} total {items.length === 1 ? 'item' : 'items'}
            </p>
            {Array.from(groupedItems.entries()).map(
              ([groupName, groupEntries]) => (
                <CollapsibleGroup
                  key={groupName}
                  label={groupName}
                  count={groupEntries.length}
                >
                  {groupEntries.map((item) => (
                    <QARow
                      key={item.id}
                      item={item}
                      selected={bulk.selectedIds.has(item.id)}
                      onToggleSelect={bulk.toggleSelect}
                    />
                  ))}
                </CollapsibleGroup>
              ),
            )}
          </div>
        ) : (
          <VirtualisedQAList
            items={items}
            selectedIds={bulk.selectedIds}
            onToggleSelect={bulk.toggleSelect}
          />
        )}
      </div>
    </section>
  );
}
