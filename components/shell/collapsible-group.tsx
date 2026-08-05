'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ContentListItem } from '@/types/content';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** @public */
export interface CollapsibleGroupProps {
  label: string;
  count: number;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// CollapsibleGroup — expandable section for grouped Q&A pairs
// ---------------------------------------------------------------------------

export function CollapsibleGroup({
  label,
  count,
  children,
}: CollapsibleGroupProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 bg-card px-4 py-2.5 text-left border-l-4 border-primary/40 hover:bg-accent transition-colors"
      >
        <span className="shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <span className="text-sm font-medium text-foreground">{label}</span>
        <Badge variant="secondary" className="ml-auto tabular-nums text-xs">
          {count}
        </Badge>
      </button>
      {expanded && <div className="space-y-2 p-3">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @public */
export type GroupBy = 'none' | 'source';

// ---------------------------------------------------------------------------
// groupItems — group ContentListItems by source document
// (the former 'domain' grouping retired with the subject axis, DR-130)
// ---------------------------------------------------------------------------

export function groupItems(
  items: ContentListItem[],
  _groupBy: GroupBy,
): Map<string, ContentListItem[]> {
  const groups = new Map<string, ContentListItem[]>();

  for (const item of items) {
    const key: string =
      item.source_file ||
      ((item.metadata as Record<string, unknown> | null)
        ?.source_file as string) ||
      'No source';

    const existing = groups.get(key);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}
