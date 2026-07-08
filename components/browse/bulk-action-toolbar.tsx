'use client';

import { AlertTriangle, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * ID-139 {139.9}: Reclassify/Tag/Assign to workspace/Delete were retired —
 * they targeted the deleted `/api/items/*` tree (ID-131 {131.17} removed the
 * `content_items` model) and had no live 1:1 replacement on the current
 * `q_a_pairs` model. Only Verify (`/api/review/action`) survives.
 */
export interface BulkActionToolbarProps {
  selectedCount: number;
  /** Number of selected items that are unverified (verified_at is null) */
  unverifiedSelectedCount?: number;
  bulkOperating: boolean;
  bulkProgress: { current: number; total: number; label: string };
  onBulkVerify: () => void;
  onClearSelection: () => void;
}

// ---------------------------------------------------------------------------
// BulkActionToolbar — appears when 1+ items selected
// ---------------------------------------------------------------------------

export function BulkActionToolbar({
  selectedCount,
  unverifiedSelectedCount,
  bulkOperating,
  bulkProgress,
  onBulkVerify,
  onClearSelection,
}: BulkActionToolbarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-10 mb-3 rounded-lg border border-primary/30 bg-primary/5 p-3 shadow-sm backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {selectedCount} selected
        </span>

        {unverifiedSelectedCount != null && unverifiedSelectedCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-md bg-status-warning/10 px-2 py-0.5 text-xs font-medium text-status-warning">
            <AlertTriangle className="size-3" aria-hidden="true" />
            {unverifiedSelectedCount} of {selectedCount} unverified
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={onBulkVerify}
            disabled={bulkOperating}
          >
            <ShieldCheck className="size-3.5" />
            Verify
          </Button>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 text-xs"
          onClick={onClearSelection}
          disabled={bulkOperating}
        >
          Clear selection
        </Button>
      </div>

      {/* Progress bar */}
      {bulkOperating && (
        <div className="mt-3 space-y-1.5">
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground"
            aria-live="polite"
          >
            <Loader2 className="size-3.5 animate-spin" />
            <span>
              {bulkProgress.label} {bulkProgress.current} of{' '}
              {bulkProgress.total}...
            </span>
          </div>
          <Progress
            value={
              bulkProgress.total > 0
                ? (bulkProgress.current / bulkProgress.total) * 100
                : 0
            }
            className="h-1.5"
          />
        </div>
      )}
    </div>
  );
}
