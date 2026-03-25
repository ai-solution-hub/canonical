'use client';

import { BookOpen, Pencil } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { DetailMode } from '@/hooks/use-detail-mode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetailModeToggleProps {
  /** Current detail mode */
  detailMode: DetailMode;
  /** Callback to toggle between modes */
  onToggle: () => void;
  /** Additional CSS classes */
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Segmented toggle for switching between Reader and Editor modes.
 * Only rendered when the user can edit (viewers never see this).
 *
 * Uses semantic tokens throughout — no raw Tailwind colours.
 */
export function DetailModeToggle({
  detailMode,
  onToggle,
  className,
}: DetailModeToggleProps) {
  const isReader = detailMode === 'reader';
  const isEditor = detailMode === 'editor';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              'inline-flex items-center rounded-lg border border-border bg-muted p-0.5',
              className,
            )}
            role="group"
            aria-label="Detail view mode"
          >
            <button
              type="button"
              onClick={isReader ? undefined : onToggle}
              aria-pressed={isReader}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isReader
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <BookOpen className="size-3.5" aria-hidden="true" />
              Read
            </button>
            <button
              type="button"
              onClick={isEditor ? undefined : onToggle}
              aria-pressed={isEditor}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                isEditor
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Edit
            </button>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Switch between reading and editing modes (Shift+D)
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
