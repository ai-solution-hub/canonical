'use client';

import { useEffect, useRef, useCallback } from 'react';
import { Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSmartDate, formatTimeShort } from '@/lib/format';

// ── Constants ──

const AUTO_DISMISS_MS = 30_000;

// ── Types ──

interface DraftRecoveryDialogProps {
  /** Whether a recovered draft exists */
  hasDraft: boolean;
  /** Timestamp of when the draft was last saved */
  lastSavedAt: Date | null;
  /** Callback when user chooses to restore the draft */
  onRestore: () => void;
  /** Callback when user chooses to discard the draft */
  onDiscard: () => void;
}

// ── Helpers ──

function formatRecoveryTime(date: Date | null): string {
  if (!date) return '';
  const iso = date.toISOString();
  const dateStr = formatSmartDate(iso);
  const timeStr = formatTimeShort(iso);

  if (dateStr === 'Today') {
    return `today at ${timeStr}`;
  }
  if (dateStr === 'Yesterday') {
    return `yesterday at ${timeStr}`;
  }
  return `${dateStr} at ${timeStr}`;
}

// ── Component ──

/**
 * Banner displayed when a recovered draft is found in localStorage.
 * Shows recovery timestamp and offers Restore / Discard actions.
 * Auto-dismisses (discards) after 30 seconds if no action is taken.
 */
export function DraftRecoveryDialog({
  hasDraft,
  lastSavedAt,
  onRestore,
  onDiscard,
}: DraftRecoveryDialogProps) {
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDiscard = useCallback(() => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
    onDiscard();
  }, [onDiscard]);

  const handleRestore = useCallback(() => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
      autoDismissRef.current = null;
    }
    onRestore();
  }, [onRestore]);

  // Auto-dismiss after 30 seconds
  useEffect(() => {
    if (!hasDraft) return;

    autoDismissRef.current = setTimeout(() => {
      onDiscard();
    }, AUTO_DISMISS_MS);

    return () => {
      if (autoDismissRef.current) {
        clearTimeout(autoDismissRef.current);
      }
    };
  }, [hasDraft, onDiscard]);

  if (!hasDraft) return null;

  const timeText = formatRecoveryTime(lastSavedAt);

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-[var(--highlight-border)] bg-[var(--highlight-bg)] px-4 py-3"
      role="alert"
      aria-live="polite"
    >
      <Info
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <p className="flex-1 text-sm text-foreground">
        Recovered unsaved draft{timeText ? ` from ${timeText}` : ''}.
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={handleRestore}
          type="button"
        >
          Restore
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDiscard}
          type="button"
          aria-label="Discard recovered draft"
        >
          <X className="size-4" aria-hidden="true" />
          <span className="sr-only">Discard</span>
        </Button>
      </div>
    </div>
  );
}
