'use client';

import { useState } from 'react';
import { AlertCircle, Send, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

/**
 * Bulk action bar for the publication-review queue.
 *
 * Spec: docs/specs/publication-approval-gate-spec.md §3.3, §3.5,
 * §8 AC-bulk-4.x. D-3 RATIFIED: 50-item cap (mirrors
 * `PublicationBulkActionBodySchema.ids.max(50)` server-side at
 * `lib/validation/schemas.ts:2255`). D-4 RATIFIED: symmetric
 * confirmation dialogs on BOTH approve and return-to-draft.
 *
 * The bar is **props-driven**: selection state lives in the queue
 * parent (`PublicationReviewQueue`); this component renders the
 * counter, master "Select all on page" checkbox, action buttons,
 * confirmation dialogs, and cap-exceeded message — and fires the
 * supplied callbacks. The mutation lifecycle (TanStack Query) is the
 * parent's concern; this bar reflects `isPending` to disable buttons
 * while a request is in flight.
 *
 * ### Cap behaviour (D-3 enforcement, client-side)
 *
 * When `selectedIds.size > 50`, the action buttons become
 * `aria-disabled="true"` (still focusable for screen-reader semantics
 * but onClick is a no-op) and an inline cap message renders below the
 * bar. The server-side Zod schema enforces the same cap; the bar is
 * defence-in-depth so users see the cap before round-tripping.
 *
 * ### Empty state
 *
 * `selectedIds.size === 0` is handled by the parent (the bar only
 * mounts when ≥1 item is selected per spec §3.3). Defensively, when
 * size === 0 we still render but with disabled action buttons and
 * counter "0 of M selected" — keeps the bar's behaviour predictable
 * if a parent forgets to unmount it.
 */

const BULK_ACTION_CAP = 50;

export interface PublicationBulkActionBarProps {
  selectedIds: Set<string>;
  pageItemCount: number;
  onSelectAllOnPage: () => void;
  onClearSelection: () => void;
  onApprove: () => void;
  onReturnToDraft: () => void;
  isPending: boolean;
  className?: string;
}

export function PublicationBulkActionBar({
  selectedIds,
  pageItemCount,
  onSelectAllOnPage,
  onClearSelection,
  onApprove,
  onReturnToDraft,
  isPending,
  className,
}: PublicationBulkActionBarProps) {
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  const selectedCount = selectedIds.size;
  const allSelected = selectedCount > 0 && selectedCount === pageItemCount;
  const someSelected = selectedCount > 0 && selectedCount < pageItemCount;
  const masterCheckedState: boolean | 'indeterminate' = allSelected
    ? true
    : someSelected
      ? 'indeterminate'
      : false;

  const capExceeded = selectedCount > BULK_ACTION_CAP;
  // Disable real action firing when: pending, no selection, or over cap.
  const actionsDisabled = isPending || selectedCount === 0 || capExceeded;

  const handleMasterCheckboxChange = (checked: boolean | 'indeterminate') => {
    // Per spec §3.3: master checkbox click toggles all rows on page.
    // When already fully selected → clear; otherwise → select all on page.
    if (checked === false) {
      onClearSelection();
    } else {
      onSelectAllOnPage();
    }
  };

  const handleApproveClick = () => {
    if (actionsDisabled) return;
    setApproveDialogOpen(true);
  };

  const handleReturnClick = () => {
    if (actionsDisabled) return;
    setReturnDialogOpen(true);
  };

  const handleApproveConfirm = () => {
    setApproveDialogOpen(false);
    onApprove();
  };

  const handleReturnConfirm = () => {
    setReturnDialogOpen(false);
    onReturnToDraft();
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label="Bulk publication actions"
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/95 p-3 sm:gap-4',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            checked={masterCheckedState}
            onCheckedChange={handleMasterCheckboxChange}
            disabled={isPending || pageItemCount === 0}
            aria-label="Select all items on page"
          />
          <span className="text-sm font-medium text-foreground">
            Select all on page
          </span>
        </div>

        <div
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {selectedCount} of {pageItemCount} selected
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            size="default"
            onClick={handleApproveClick}
            disabled={isPending || selectedCount === 0}
            aria-disabled={capExceeded || undefined}
            className="min-h-[44px] gap-2 font-semibold"
            aria-label="Approve selected items"
          >
            <Send className="size-4" aria-hidden="true" />
            Approve selected
          </Button>

          <Button
            variant="outline"
            size="default"
            onClick={handleReturnClick}
            disabled={isPending || selectedCount === 0}
            aria-disabled={capExceeded || undefined}
            className="min-h-[44px] gap-2"
            aria-label="Return selected items to draft"
          >
            <Undo2 className="size-4" aria-hidden="true" />
            Return selected to draft
          </Button>

          <Button
            variant="ghost"
            size="default"
            onClick={onClearSelection}
            disabled={isPending || selectedCount === 0}
            className="min-h-[44px] gap-2"
            aria-label="Clear selection"
          >
            Clear selection
          </Button>
        </div>

        {capExceeded ? (
          <p
            role="status"
            className="flex basis-full items-center gap-2 text-sm text-destructive"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>At most 50 items per request. Deselect some to continue.</span>
          </p>
        ) : null}
      </div>

      {/* Approve confirmation (D-4 RATIFIED) */}
      <AlertDialog
        open={approveDialogOpen}
        onOpenChange={setApproveDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve {selectedCount}{' '}
              {selectedCount === 1 ? 'item' : 'items'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This publishes them to the knowledge base immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleApproveConfirm}>
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Return-to-draft confirmation (D-4 RATIFIED — symmetric) */}
      <AlertDialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Return {selectedCount}{' '}
              {selectedCount === 1 ? 'item' : 'items'} to draft?
            </AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Confirm bulk return-to-draft action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReturnConfirm}>
              Return to draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
