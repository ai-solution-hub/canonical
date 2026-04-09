'use client';

import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ItemCompletenessChecklistProps {
  brief: string | null;
  detail: string | null;
  contentOwnerId: string | null;
  className?: string;
}

/**
 * Editor-sidebar checklist showing which completeness signals are present on
 * an item. Replaces the `Curated` trust tier that used to appear as a header
 * badge on the verification badge (retired in S157 WP4).
 *
 * Editors and admins only — render this inside a `canEdit` guard at the call
 * site. Not rendered for viewers.
 */
export function ItemCompletenessChecklist({
  brief,
  detail,
  contentOwnerId,
  className,
}: ItemCompletenessChecklistProps) {
  const items = [
    { label: 'Has a brief summary', complete: !!brief },
    { label: 'Has detailed content', complete: !!detail },
    { label: 'Has a content owner', complete: !!contentOwnerId },
  ];

  return (
    <section
      aria-labelledby="item-completeness-heading"
      className={cn('rounded-lg border bg-card p-3', className)}
    >
      <h3
        id="item-completeness-heading"
        className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Item completeness
      </h3>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.label}
            data-complete={item.complete ? 'true' : 'false'}
            className="flex items-center gap-2 text-xs text-foreground"
          >
            {item.complete ? (
              <CheckCircle2
                className="size-3.5 text-[var(--color-status-success)]"
                aria-hidden="true"
              />
            ) : (
              <Circle
                className="size-3.5 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <span className={cn(!item.complete && 'text-muted-foreground')}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
