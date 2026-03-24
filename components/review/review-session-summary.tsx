'use client';

import { useCallback } from 'react';
import { CheckCircle2, AlertTriangle, SkipForward, ClipboardList, Download, Clock } from 'lucide-react';
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
 * Formats current date/time in UK format: DD/MM/YYYY HH:MM
 */
function formatUkDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

/**
 * Generates a plain-text summary of the review session for download.
 */
function generateSummaryText(stats: ReviewSessionStats, durationMs?: number): string {
  const lines = [
    'Review Session Summary',
    `Date: ${formatUkDateTime(new Date())}`,
  ];

  if (durationMs != null) {
    lines.push(`Duration: ${formatDuration(durationMs)}`);
  }

  lines.push(
    '',
    `Total reviewed: ${stats.total}`,
    `Verified: ${stats.verified}`,
    `Flagged: ${stats.flagged}`,
    `Skipped: ${stats.skipped}`,
  );

  return lines.join('\n');
}

/**
 * Summary dialog shown when a curator exits a review session.
 * Displays stats for items reviewed, verified, flagged, and skipped,
 * with an optional download of the session summary.
 */
export function ReviewSessionSummary({
  open,
  onOpenChange,
  stats,
  sessionDuration,
}: ReviewSessionSummaryProps) {
  const handleDownload = useCallback(() => {
    const text = generateSummaryText(stats, sessionDuration);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `review-session-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up the object URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [stats, sessionDuration]);

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
                <Clock className="mr-1 inline-block size-3.5 align-text-bottom" aria-hidden="true" />
                Session duration: {formatDuration(sessionDuration)}
              </>
            ) : (
              'Review session complete'
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3" role="list" aria-label="Session statistics">
          {statItems.map(({ label, value, icon: Icon, colourClass, bgClass }) => (
            <div
              key={label}
              role="listitem"
              className={cn('flex items-center gap-3 rounded-lg p-3', bgClass)}
            >
              <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', bgClass, colourClass)}>
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className={cn('text-lg font-semibold tabular-nums', colourClass)}>
                  {value.toLocaleString('en-GB')}
                </div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            className="gap-1.5"
          >
            <Download className="size-3.5" aria-hidden="true" />
            Download summary
          </Button>
          <Button
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Export helpers for testing
export { formatDuration, formatUkDateTime, generateSummaryText };
