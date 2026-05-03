'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

import type {
  PublicationBulkActionResponse,
  PublicationBulkActionResult,
} from '@/lib/query/fetchers';

/**
 * Result dialog shown after a bulk publication-action request resolves.
 *
 * Spec: docs/specs/publication-approval-gate-spec.md §7.7,
 * §8 AC-bulk-4.x. Surfaces per-item failures grouped by row, with the
 * item title looked up from the in-memory queue (the
 * `itemTitleLookup` Map). When a result row's id is no longer in the
 * lookup (e.g. item deleted mid-iteration), falls back to the UUID
 * with the spec-prescribed annotation "(item no longer in queue)".
 *
 * The parent (`PublicationReviewQueue`) decides when to open this:
 * the typical pattern is to open it on the warning toast's "View
 * details" affordance when `failureCount > 0`. When `failureCount === 0`
 * the parent shows a plain success toast and never opens this dialog
 * (per §3.4); however, this component still renders an all-success
 * summary if forced open with such a response — keeps the API simple.
 *
 * `response === null` is the "no data yet" sentinel — dialog content
 * is not rendered. The Radix `<Dialog>` `open` flag still controls
 * visibility; the parent should keep `open=false` until a response
 * arrives.
 */

export interface PublicationBulkResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  response: PublicationBulkActionResponse | null;
  /** id → title lookup, taken from the current queue items array. */
  itemTitleLookup: Map<string, string>;
}

export function PublicationBulkResultDialog({
  open,
  onOpenChange,
  response,
  itemTitleLookup,
}: PublicationBulkResultDialogProps) {
  // When response is null, render nothing — per spec §7.7: "When
  // `response === null`, render nothing inside dialog." The parent
  // should keep `open=false` until a response arrives; if it does
  // open the dialog with response=null we render nothing rather than
  // an a11y-broken empty dialog. Returning null also prevents the
  // Radix DialogContent missing-title warning.
  if (response === null) {
    return null;
  }

  const failures = response.results.filter(
    (r) => r.status !== 'success',
  );
  const isAllSuccess = response.failureCount === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          {isAllSuccess ? (
            <>
              <DialogTitle>
                {response.successCount}{' '}
                {response.successCount === 1 ? 'item' : 'items'} published
              </DialogTitle>
              <DialogDescription>
                All requested items transitioned successfully.
              </DialogDescription>
            </>
          ) : (
            <>
              <DialogTitle>
                {response.failureCount} of {response.totalRequested} items
                could not be published
              </DialogTitle>
              <DialogDescription>
                {response.successCount > 0
                  ? `${response.successCount} succeeded; review the failures below.`
                  : 'Review the failures below.'}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        {failures.length > 0 ? (
          <ul className="flex flex-col gap-3 max-h-[50vh] overflow-y-auto">
            {failures.map((result) => (
              <FailureRow
                key={result.id}
                result={result}
                title={itemTitleLookup.get(result.id)}
              />
            ))}
          </ul>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            aria-label="Close bulk action result dialog"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FailureRowProps {
  result: PublicationBulkActionResult;
  title: string | undefined;
}

function FailureRow({ result, title }: FailureRowProps) {
  const reasonText =
    result.reason ??
    result.error ??
    statusFallbackReason(result.status);

  // Per spec §7.7: title from lookup, or "<UUID> (item no longer in queue)"
  // if not present.
  const displayLabel =
    title ?? `${result.id} (item no longer in queue)`;

  return (
    <li className="flex flex-col gap-1 rounded-md border border-border bg-card/50 p-3">
      <span className="text-sm font-medium text-foreground">
        {displayLabel}
      </span>
      <span className="text-sm text-muted-foreground">{reasonText}</span>
    </li>
  );
}

function statusFallbackReason(
  status: PublicationBulkActionResult['status'],
): string {
  switch (status) {
    case 'conflict':
      return 'Concurrent state change detected.';
    case 'forbidden':
      return 'Action not permitted for this item.';
    case 'not_found':
      return 'Item no longer exists or is not visible to you.';
    case 'error':
      return 'Unknown error.';
    case 'success':
      // Should never reach here — `failures` filters success out.
      return '';
  }
}
