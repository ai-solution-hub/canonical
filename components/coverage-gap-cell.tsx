'use client';

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
  subtopicName,
  formatSubtopic,
}: CoverageGapCellProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 bg-muted/30 p-3',
        'min-h-[5.5rem]',
      )}
      aria-label={`${formatSubtopic(subtopicName)} — no content`}
    >
      <span className="text-xs font-medium text-muted-foreground/70">
        {formatSubtopic(subtopicName)}
      </span>
      <span className="text-xs text-muted-foreground/50">No content</span>
    </div>
  );
}
