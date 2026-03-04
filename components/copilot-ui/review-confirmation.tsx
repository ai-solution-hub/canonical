'use client';

import { AlertCircle, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ReviewConfirmationProps {
  questionId: string | null;
  isLoading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation UI rendered inline in the CopilotKit chat sidebar when
 * the AI attempts to submit a response for review. This implements the
 * human-in-the-loop pattern via renderAndWaitForResponse.
 */
export function ReviewConfirmation({
  questionId,
  isLoading,
  onConfirm,
  onCancel,
}: ReviewConfirmationProps) {
  if (!questionId) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="size-4" aria-hidden="true" />
          No question selected
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card px-3 py-3">
      <p className="text-sm font-medium">Submit for review?</p>
      <p className="mt-1 text-xs text-muted-foreground">
        This will save the current response and mark it as ready for
        review.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={isLoading}
          className="gap-1.5"
          type="button"
        >
          {isLoading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
          Confirm
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={isLoading}
          className="gap-1.5"
          type="button"
        >
          <X className="size-3.5" aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
