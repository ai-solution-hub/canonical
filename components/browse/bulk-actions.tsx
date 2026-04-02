'use client';

import { BookCheck, ClipboardCheck, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BulkActionsProps {
  selectedCount: number;
  onMarkSelectedRead: () => void;
  onCancel: () => void;
  /** Show the "Send to review" action (editor/admin only) */
  canSendToReview?: boolean;
  onSendToReview?: () => void;
  /** Whether the send-to-review request is in flight */
  isSendingToReview?: boolean;
}

export function BulkActions({
  selectedCount,
  onMarkSelectedRead,
  onCancel,
  canSendToReview = false,
  onSendToReview,
  isSendingToReview = false,
}: BulkActionsProps) {
  return (
    <div
      className="mt-4 flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5"
      role="status"
      aria-live="polite"
    >
      <span className="text-sm font-medium text-foreground">
        {selectedCount} selected
      </span>
      <Button
        variant="default"
        size="sm"
        onClick={onMarkSelectedRead}
        className="gap-1.5"
      >
        <BookCheck className="size-3.5" />
        Mark as read
      </Button>
      {canSendToReview && onSendToReview && (
        <Button
          variant="outline"
          size="sm"
          onClick={onSendToReview}
          disabled={isSendingToReview}
          className="gap-1.5"
        >
          {isSendingToReview ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ClipboardCheck className="size-3.5" />
          )}
          Send to review
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5">
        <X className="size-3.5" />
        Cancel
      </Button>
    </div>
  );
}
