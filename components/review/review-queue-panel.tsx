'use client';

import { useEffect, useRef } from 'react';
import { DomainBadge } from '@/components/shared/domain-badge';
import { Badge } from '@/components/ui/badge';
import { Check, Flag } from 'lucide-react';
import { getDisplayTitle } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReviewQueueItem } from '@/types/review';

interface ReviewQueuePanelProps {
  items: ReviewQueueItem[];
  currentIndex: number;
  onSelectItem: (index: number) => void;
}

export function ReviewQueuePanel({
  items,
  currentIndex,
  onSelectItem,
}: ReviewQueuePanelProps) {
  const currentRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to current item
  useEffect(() => {
    currentRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [currentIndex]);

  return (
    <div className="flex h-full flex-col">
      {/* Queue list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {items.map((item, index) => {
          const isCurrent = index === currentIndex;
          const isFlagged = item.governance_review_status === 'pending';
          const title = getDisplayTitle({
            suggested_title: item.suggested_title,
            title: item.title,
            content: item.content,
          });

          return (
            <button
              key={item.id}
              ref={isCurrent ? currentRef : undefined}
              type="button"
              onClick={() => onSelectItem(index)}
              className={cn(
                'w-full border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-accent',
                isCurrent && 'border-l-2 border-l-primary bg-accent',
              )}
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={title}
            >
              <div className="flex items-center gap-1.5">
                {item.primary_domain && (
                  <DomainBadge domain={item.primary_domain} />
                )}
                {item.content_type && (
                  <Badge variant="secondary" className="text-[10px]">
                    {item.content_type.replace(/_/g, ' ')}
                  </Badge>
                )}
                {isFlagged && (
                  <span className="ml-auto" aria-label="Flagged for review">
                    <Flag
                      className="size-3.5 text-status-warning"
                      aria-hidden="true"
                    />
                  </span>
                )}
                {!isFlagged && item.verified_at && (
                  <span className="ml-auto" aria-label="Verified">
                    <Check
                      className="size-3.5 text-success"
                      aria-hidden="true"
                    />
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-1 text-sm font-medium text-foreground">
                {title}
              </p>
              {item.summary && (
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                  {item.summary}
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        {items.length} {items.length === 1 ? 'item' : 'items'} loaded
      </div>
    </div>
  );
}
