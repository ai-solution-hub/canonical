'use client';

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ContentCard } from '@/components/content-card';
import { cn } from '@/lib/utils';
import type { ContentListItem, SearchResult } from '@/types/content';
import type { OnOptimisticUpdate } from '@/hooks/use-quick-review';

const MIN_CARD_WIDTH = 280;
const ESTIMATED_ROW_HEIGHT = 380;
const COMPACT_ROW_HEIGHT = 240;
const ROW_GAP = 16;
const OVERSCAN_ROWS = 3;

/** Threshold below which we skip virtualisation and render a plain CSS grid */
const SIMPLE_GRID_THRESHOLD = 24;

interface ContentGridProps {
  items: (ContentListItem | SearchResult)[];
  activeIndex?: number;
  readItemIds?: Set<string>;
  qualityFlaggedIds?: Set<string>;
  multiSelectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (itemId: string) => void;
  hideThumbnails?: boolean;
  highlightQuery?: string;
  /** Whether the current user can edit (editor/admin). Enables quick review actions. */
  canEdit?: boolean;
  /** Callback for optimistic item state updates (verify/flag actions) */
  onQuickReviewUpdate?: OnOptimisticUpdate;
}

export function ContentGrid({
  items,
  activeIndex,
  readItemIds,
  qualityFlaggedIds,
  multiSelectMode,
  selectedIds,
  onToggleSelect,
  hideThumbnails,
  highlightQuery,
  canEdit,
  onQuickReviewUpdate,
}: ContentGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const focusedIndexRef = useRef(-1);

  const updateColumns = useCallback(() => {
    if (!parentRef.current) return;
    const width = parentRef.current.clientWidth;
    setColumns(Math.max(1, Math.floor(width / MIN_CARD_WIDTH)));
  }, []);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;

    // Initial measurement
    updateColumns();

    const observer = new ResizeObserver(() => {
      updateColumns();
    });
    observer.observe(el);

    return () => observer.disconnect();
  }, [updateColumns]);

  const rowCount = Math.ceil(items.length / columns);

  const rowHeight = hideThumbnails ? COMPACT_ROW_HEIGHT : ESTIMATED_ROW_HEIGHT;

  const [scrollMargin, setScrollMargin] = useState(0);
  useEffect(() => {
    const recalc = () => {
      if (parentRef.current) {
        setScrollMargin(parentRef.current.offsetTop);
      }
    };
    recalc();
    // Recalculate on window resize (header height may change)
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [items.length]);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => rowHeight,
    gap: ROW_GAP,
    overscan: OVERSCAN_ROWS,
    scrollMargin,
  });

  // Compute the active row from the activeIndex
  const activeRow = useMemo(() => {
    if (activeIndex == null || activeIndex < 0) return -1;
    return Math.floor(activeIndex / columns);
  }, [activeIndex, columns]);

  // Scroll the active row into view
  useEffect(() => {
    if (activeRow >= 0) {
      virtualizer.scrollToIndex(activeRow, { align: 'auto' });
    }
  }, [activeRow, virtualizer]);

  // Arrow key navigation across grid cards
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        return;
      }

      e.preventDefault();
      const total = items.length;
      if (total === 0) return;

      const current = focusedIndexRef.current < 0 ? 0 : focusedIndexRef.current;
      let next = current;

      switch (e.key) {
        case 'ArrowRight':
          next = Math.min(current + 1, total - 1);
          break;
        case 'ArrowLeft':
          next = Math.max(current - 1, 0);
          break;
        case 'ArrowDown':
          next = Math.min(current + columns, total - 1);
          break;
        case 'ArrowUp':
          next = Math.max(current - columns, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = total - 1;
          break;
      }

      focusedIndexRef.current = next;

      // Scroll the target row into view (only needed for virtualised grid)
      if (items.length > SIMPLE_GRID_THRESHOLD) {
        const targetRow = Math.floor(next / columns);
        virtualizer.scrollToIndex(targetRow, { align: 'auto' });
      }

      // Focus the card link after DOM update
      requestAnimationFrame(() => {
        const container = parentRef.current;
        if (!container) return;
        const card = container.querySelector<HTMLElement>(
          `[data-grid-index="${next}"] a, [data-grid-index="${next}"] [role="button"]`,
        );
        card?.focus();
      });
    },
    [items.length, columns, virtualizer],
  );

  if (items.length === 0) return null;

  // Simple CSS grid for small item counts — no virtualisation, no scroll container
  if (items.length <= SIMPLE_GRID_THRESHOLD) {
    return (
      <div
        ref={parentRef}
        role="feed"
        aria-label="Content items"
        aria-busy={false}
        onKeyDown={handleGridKeyDown}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      >
        {items.map((item, idx) => {
          const isActive = activeIndex != null && idx === activeIndex;
          return (
            <div
              key={item.id}
              role="article"
              aria-setsize={items.length}
              aria-posinset={idx + 1}
              data-grid-index={idx}
              className={cn('relative rounded-lg', isActive && 'ring-2 ring-ring ring-offset-2')}
            >
              {multiSelectMode && (
                <button
                  role="checkbox"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleSelect?.(item.id);
                  }}
                  className="absolute left-2 top-2 z-10 flex items-center justify-center rounded border border-border bg-background/90 p-2.5 shadow-sm transition-colors hover:bg-accent"
                  aria-label={
                    selectedIds?.has(item.id) ? 'Deselect' : 'Select'
                  }
                  aria-checked={selectedIds?.has(item.id) ?? false}
                >
                  <span
                    className={`size-3.5 rounded-sm border ${selectedIds?.has(item.id) ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}
                  >
                    {selectedIds?.has(item.id) && (
                      <svg
                        viewBox="0 0 14 14"
                        fill="none"
                        className="size-full text-primary-foreground"
                      >
                        <path
                          d="M3 7l3 3 5-5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                </button>
              )}
              <ContentCard
                item={item}
                isRead={readItemIds ? readItemIds.has(item.id) : undefined}
                hasQualityFlag={qualityFlaggedIds ? qualityFlaggedIds.has(item.id) : undefined}
                hideThumbnail={hideThumbnails}
                highlightQuery={highlightQuery}
                canEdit={canEdit}
                onQuickReviewUpdate={onQuickReviewUpdate}
              />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      role="feed"
      aria-label="Content items"
      aria-busy={false}
      onKeyDown={handleGridKeyDown}
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '0 800px',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns;
          const rowItems = items.slice(startIndex, startIndex + columns);

          return (
            <div
              key={virtualRow.index}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {rowItems.map((item, colIdx) => {
                  const itemIndex = virtualRow.index * columns + colIdx;
                  const isActive = activeIndex != null && itemIndex === activeIndex;
                  return (
                  <div
                    key={item.id}
                    role="article"
                    aria-setsize={items.length}
                    aria-posinset={itemIndex + 1}
                    data-grid-index={itemIndex}
                    className={cn('relative rounded-lg', isActive && 'ring-2 ring-ring ring-offset-2')}
                  >
                    {multiSelectMode && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleSelect?.(item.id);
                        }}
                        className="absolute left-2 top-2 z-10 flex items-center justify-center rounded border border-border bg-background/90 p-2.5 shadow-sm transition-colors hover:bg-accent"
                        aria-label={
                          selectedIds?.has(item.id) ? 'Deselect' : 'Select'
                        }
                      >
                        <span
                          className={`size-3.5 rounded-sm border ${selectedIds?.has(item.id) ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}
                        >
                          {selectedIds?.has(item.id) && (
                            <svg
                              viewBox="0 0 14 14"
                              fill="none"
                              className="size-full text-primary-foreground"
                            >
                              <path
                                d="M3 7l3 3 5-5"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                      </button>
                    )}
                    <ContentCard
                      item={item}
                      isRead={
                        readItemIds ? readItemIds.has(item.id) : undefined
                      }
                      hasQualityFlag={qualityFlaggedIds ? qualityFlaggedIds.has(item.id) : undefined}
                      hideThumbnail={hideThumbnails}
                      highlightQuery={highlightQuery}
                      canEdit={canEdit}
                      onQuickReviewUpdate={onQuickReviewUpdate}
                    />
                  </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
