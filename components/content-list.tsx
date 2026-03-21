'use client';

import { useRef, useState, useEffect } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ContentRow } from '@/components/content-row';
import type { ContentListItem, SearchResult } from '@/types/content';

interface ContentListProps {
  items: (ContentListItem | SearchResult)[];
  activeIndex?: number;
  readItemIds?: Set<string>;
  qualityFlaggedIds?: Set<string>;
  multiSelectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (itemId: string) => void;
  highlightQuery?: string;
}

export function ContentList({
  items,
  activeIndex,
  readItemIds,
  qualityFlaggedIds,
  multiSelectMode,
  selectedIds,
  onToggleSelect,
  highlightQuery,
}: ContentListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const [scrollMargin, setScrollMargin] = useState(0);
  useEffect(() => {
    const recalc = () => {
      if (parentRef.current) {
        setScrollMargin(parentRef.current.offsetTop);
      }
    };
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, [items.length]);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => 64,
    overscan: 10,
    scrollMargin,
  });

  if (items.length === 0) return null;

  return (
    <div
      ref={parentRef}
      role="feed"
      aria-label="Content items"
      className="rounded-lg border border-border"
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '0 600px',
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = items[virtualItem.index];
          return (
            <div
              key={item.id}
              role="article"
              aria-setsize={items.length}
              aria-posinset={virtualItem.index + 1}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <div className="flex w-full items-center">
                {multiSelectMode && (
                  <button
                    role="checkbox"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onToggleSelect?.(item.id);
                    }}
                    className="flex shrink-0 items-center justify-center px-2"
                    aria-label={
                      selectedIds?.has(item.id) ? 'Deselect' : 'Select'
                    }
                    aria-checked={selectedIds?.has(item.id) ?? false}
                    style={{ minHeight: '44px', minWidth: '44px' }}
                  >
                    <span
                      className={`flex size-4 items-center justify-center rounded-sm border ${selectedIds?.has(item.id) ? 'border-primary bg-primary' : 'border-muted-foreground/40'}`}
                    >
                      {selectedIds?.has(item.id) && (
                        <svg
                          viewBox="0 0 14 14"
                          fill="none"
                          className="size-3 text-primary-foreground"
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
                <ContentRow
                  item={item}
                  isActive={virtualItem.index === activeIndex}
                  isRead={readItemIds ? readItemIds.has(item.id) : undefined}
                  hasQualityFlag={qualityFlaggedIds ? qualityFlaggedIds.has(item.id) : undefined}
                  highlightQuery={highlightQuery}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
