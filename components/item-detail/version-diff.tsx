'use client';

import { useMemo } from 'react';
import { diffWords } from 'diff';
import { cn } from '@/lib/utils';

interface VersionDiffProps {
  oldText: string;
  newText: string;
  className?: string;
}

/**
 * Word-level diff display.
 * Shows additions in green and removals in red with strikethrough.
 * WCAG: uses both colour and text decoration (strikethrough/underline) for meaning.
 */
export function VersionDiff({ oldText, newText, className }: VersionDiffProps) {
  const parts = useMemo(() => diffWords(oldText, newText), [oldText, newText]);

  if (oldText === newText) {
    return (
      <p className={cn('text-sm text-muted-foreground italic', className)}>
        No differences
      </p>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap',
        className,
      )}
      role="region"
      aria-label="Content differences"
    >
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <span
              key={i}
              className="bg-freshness-fresh-bg text-status-success underline decoration-status-success"
              aria-label={`Added: ${part.value}`}
            >
              {part.value}
            </span>
          );
        }
        if (part.removed) {
          return (
            <span
              key={i}
              className="bg-freshness-stale-bg text-destructive line-through decoration-destructive"
              aria-label={`Removed: ${part.value}`}
            >
              {part.value}
            </span>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </div>
  );
}
