'use client';

import {
  CheckCircle2,
  AlertTriangle,
  SkipForward,
  ClipboardList,
  Clock,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ReviewSessionStats {
  total: number;
  verified: number;
  flagged: number;
  skipped: number;
}

/** @public */
export interface ReviewSessionSummaryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: ReviewSessionStats;
  sessionDuration?: number; // milliseconds
}

/**
 * Formats milliseconds into a human-readable duration string.
 * E.g. 125000 -> "2m 5s", 45000 -> "45s", 3600000 -> "1h 0m 0s"
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Summary dialog shown when a curator exits a review session.
 * Displays stats for items reviewed, verified, flagged, and skipped.
 */
export function ReviewSessionSummary({
  open,
  onOpenChange,
  stats,
  sessionDuration,
}: ReviewSessionSummaryProps) {
  const statItems = [
    {
      label: 'Total reviewed',
      value: stats.total,
      icon: ClipboardList,
      colourClass: 'text-foreground',
      bgClass: 'bg-muted',
    },
    {
      label: 'Verified',
      value: stats.verified,
      icon: CheckCircle2,
      colourClass: 'text-freshness-fresh',
      bgClass: 'bg-freshness-fresh-bg',
    },
    {
      label: 'Flagged',
      value: stats.flagged,
      icon: AlertTriangle,
      colourClass: 'text-destructive',
      bgClass: 'bg-destructive/10',
    },
    {
      label: 'Skipped',
      value: stats.skipped,
      icon: SkipForward,
      colourClass: 'text-muted-foreground',
      bgClass: 'bg-muted',
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Session summary</DialogTitle>
          <DialogDescription>
            {sessionDuration != null ? (
              <>
                <Clock
                  className="mr-1 inline-block size-3.5 align-text-bottom"
                  aria-hidden="true"
                />
                Session duration: {formatDuration(sessionDuration)}
              </>
            ) : (
              'Review session complete'
            )}
          </DialogDescription>
        </DialogHeader>

        <div
          className="grid grid-cols-2 gap-3"
          role="list"
          aria-label="Session statistics"
        >
          {statItems.map(
            ({ label, value, icon: Icon, colourClass, bgClass }) => (
              <div
                key={label}
                role="listitem"
                className={cn(
                  'flex items-center gap-3 rounded-lg p-3',
                  bgClass,
                )}
              >
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full',
                    bgClass,
                    colourClass,
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <div
                    className={cn(
                      'text-lg font-semibold tabular-nums',
                      colourClass,
                    )}
                  >
                    {value.toLocaleString('en-GB')}
                  </div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              </div>
            ),
          )}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export helper for testing
export { formatDuration };
