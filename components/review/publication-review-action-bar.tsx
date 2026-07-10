'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Undo2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  mutationBulkPublicationAction,
  ApiError,
  type PublicationBulkActionResponse,
} from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';

/**
 * Per-row action bar for the "Awaiting publication" tab on /review.
 *
 * Renders the three actions defined in
 * `docs/specs/review-page-tabs-refactor-spec.md` §7:
 *   - Approve & publish → POST /api/review/publication-bulk-action body
 *     `{ ids: [itemId], action: 'approve' }` (single-item call)
 *   - Return to draft     → POST /api/review/publication-bulk-action body
 *     `{ ids: [itemId], action: 'return_to_draft' }`
 *   - Open in editor      → <Link href="/documents/[id]"> (NOT router.push,
 *     so middle-click / cmd-click open in a new tab as users expect, per
 *     spec §7 + AC (i)). ID-135.26: re-pointed off the deleted `/item/[id]`
 *     ({131.17}) — itemId is a source_documents id, and /documents/[id] is
 *     the live (read-only) detail surface for that grain. Whether a genuine
 *     editing surface should exist for in-review source_documents is an
 *     open product question, flagged separately — not decided here.
 *
 * ID-131 endgame B3-ext (S447): re-pointed off the doomed
 * `PATCH /api/items/[id]` route onto the same
 * `POST /api/review/publication-bulk-action` endpoint the bulk action bar
 * uses (`components/review/PublicationReviewQueue.tsx`), via the shared
 * `mutationBulkPublicationAction()` fetcher — single-item `ids` array. That
 * route ALWAYS resolves HTTP 200 with a structured per-item `results[]`
 * entry (`success` | `conflict` | `forbidden` | `not_found` | `error`); it
 * throws `ApiError` only for route-level failures (auth / rate-limit /
 * validation / crash). So the per-item outcome is read out of
 * `response.results[0]` in `onSuccess`, NOT surfaced via `onError` — see
 * the same pattern at `PublicationReviewQueue.tsx`'s `bulkMutation`.
 *
 * S215 OQ2 (ratified by Liam in S215 kickoff): NO Enter binding on
 * Approve & publish. The button responds to click only. Approve is a
 * high-stakes action and the spec rejects implicit keyboard activation
 * to prevent accidental publishes.
 *
 * AC (j): Editor role can see all three buttons. The role-gate matrix in
 * `lib/governance/publication-transitions.ts` denies non-admin transitions
 * out of `'in_review'` via a `results[0].status === 'forbidden'` entry (NOT
 * an HTTP 403 — the bulk-action route folds per-item role-gate failures into
 * the 200 envelope) — the UI surfaces it as a `sonner` toast WITHOUT
 * client-side button hide (graceful server-driven gate per spec §7).
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7, §8 (g)/(h)/(i)/(j).
 */

interface PublicationReviewActionBarProps {
  itemId: string;
  className?: string;
}

export function PublicationReviewActionBar({
  itemId,
  className,
}: PublicationReviewActionBarProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation<
    PublicationBulkActionResponse,
    ApiError,
    'published' | 'draft'
  >({
    mutationFn: async (target) =>
      mutationBulkPublicationAction({
        ids: [itemId],
        action: target === 'published' ? 'approve' : 'return_to_draft',
      }),
    onSuccess: (response, target) => {
      const result = response.results[0];

      if (!result || result.status !== 'success') {
        // Per-item failure — the bulk-action route always resolves 200 with
        // a structured per-item status (never thrown); see the doc comment
        // above. Map the same copy the old PATCH-error-status handling used.
        if (result?.status === 'forbidden') {
          toast.error(
            'Approval is admin-only. Ask an admin to publish this item.',
          );
        } else if (result?.status === 'conflict') {
          toast.error(
            'The item state has changed. Refresh the queue and try again.',
          );
        } else {
          toast.error(
            result?.reason ??
              result?.error ??
              'Action failed. Please try again.',
          );
        }
        return;
      }

      // Invalidate the publication-review queue + the broader review
      // namespace so progress badges + queue listings update everywhere.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.review.publicationReviewQueue(),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.review.stats });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.contentItems.detail(itemId),
      });
      toast.success(
        target === 'published'
          ? 'Published. The item is now live in the knowledge base.'
          : 'Returned to draft. The item is no longer in the publication queue.',
      );
    },
    onError: (err) => {
      // Route-level failure only (auth, rate-limit, validation, crash) —
      // per-item outcomes (forbidden/conflict/not_found) resolve via
      // onSuccess per the bulk-action route's structured-results contract.
      // Spec §7 / AC (j): no client-side button hide either way.
      if (err.status === 403) {
        toast.error(
          'Approval is admin-only. Ask an admin to publish this item.',
        );
      } else if (err.status === 429) {
        toast.error('Too many requests. Wait a moment and try again.');
      } else {
        toast.error(err.message || 'Action failed. Please try again.');
      }
    },
  });

  const { mutate } = mutation;
  const handleApprove = useCallback(() => {
    mutate('published');
  }, [mutate]);

  const handleReturnToDraft = useCallback(() => {
    mutate('draft');
  }, [mutate]);

  const isPending = mutation.isPending;

  return (
    <div
      role="toolbar"
      aria-label="Publication review actions"
      className={cn(
        'flex flex-wrap items-center gap-2 border-t border-border bg-card/95 p-3 sm:gap-3',
        className,
      )}
    >
      <Button
        size="default"
        onClick={handleApprove}
        disabled={isPending}
        className="min-h-[44px] gap-2 font-semibold"
        aria-label="Approve and publish this item"
      >
        <Send className="size-4" aria-hidden="true" />
        Approve &amp; publish
      </Button>

      <Button
        variant="outline"
        size="default"
        onClick={handleReturnToDraft}
        disabled={isPending}
        className="min-h-[44px] gap-2"
        aria-label="Return this item to draft"
      >
        <Undo2 className="size-4" aria-hidden="true" />
        Return to draft
      </Button>

      <Button
        asChild
        variant="ghost"
        size="default"
        className="min-h-[44px] gap-2"
      >
        {/* Next.js Link (NOT router.push) so middle-click / cmd-click
            opens in a new tab. Spec §7 + AC (i).
            ID-135.26: itemId is a source_documents id (this queue is
            entirely source_documents-backed post-{131.19} — see
            app/api/review/queue/route.ts's in_review branch). Re-homed to
            /documents/[id] (the live source_document detail surface);
            content_items/`/item/[id]` no longer exist. */}
        <Link
          href={`/documents/${itemId}`}
          aria-label="Open this item in the editor"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Open in editor
        </Link>
      </Button>
    </div>
  );
}
