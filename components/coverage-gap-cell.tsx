'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoverageGapCellProps {
  domainName: string;
  subtopicName: string;
  formatSubtopic: (subtopic: string) => string;
}

// ---------------------------------------------------------------------------
// Coverage Gap Cell — subtopic with 0 items
// ---------------------------------------------------------------------------

export function CoverageGapCell({
  domainName,
  subtopicName,
  formatSubtopic,
}: CoverageGapCellProps) {
  return (
    <Link
      href={`/browse?domain=${encodeURIComponent(domainName)}&subtopic=${encodeURIComponent(subtopicName)}`}
      className={cn(
        'group flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 bg-muted/30 p-3',
        'min-h-[5.5rem]',
        'transition-colors hover:border-primary/40 hover:bg-muted/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
      aria-label={`${formatSubtopic(subtopicName)} — no content — click to browse`}
    >
      <span className="text-xs font-medium text-muted-foreground">
        {formatSubtopic(subtopicName)}
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground/80">
        <span className="group-hover:hidden">No content</span>
        <span className="hidden items-center gap-0.5 group-hover:flex">
          <Plus className="size-3" aria-hidden="true" />
          Add content
        </span>
      </span>
    </Link>
  );
}
