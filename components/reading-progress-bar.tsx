'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ReadingProgressBarProps {
  /** Reading progress percentage (0-100) */
  readProgress: number;
  /** Whether to show the floating progress badge */
  showProgressBadge: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Sticky reading progress bar with floating percentage badge */
export function ReadingProgressBar({
  readProgress,
  showProgressBadge,
}: ReadingProgressBarProps) {
  return (
    <>
      {/* Progress bar (sticky at top of reader area) */}
      <div className="sticky top-0 z-20 h-0.5 w-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-150 ease-out"
          style={{ width: `${readProgress}%` }}
          role="progressbar"
          aria-valuenow={Math.round(readProgress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Reading progress"
        />
      </div>

      {/* Progress badge (appears on scroll) */}
      <div
        className={cn(
          'pointer-events-none fixed right-4 top-4 z-30 transition-opacity duration-200',
          showProgressBadge ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Badge variant="secondary" className="text-xs font-medium shadow-sm">
          {Math.round(readProgress)}%
        </Badge>
      </div>
    </>
  );
}
