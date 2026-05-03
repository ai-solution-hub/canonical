'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Undo2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mutationFetchJson, ApiError } from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';

/**
 * Per-row action bar for the "Awaiting publication" tab on /review.
 *
 * Renders the three actions defined in
 * `docs/specs/review-page-tabs-refactor-spec.md` §7:
 *   - Approve & publish → PATCH /api/items/[id] body
 *     `{ field: 'publication_status', value: 'published' }`
 *   - Return to draft     → PATCH /api/items/[id] body
 *     `{ field: 'publication_status', value: 'draft' }`
 *   - Open in editor      → <Link href="/item/[id]"> (NOT router.push, so
 *     middle-click / cmd-click open in a new tab as users expect, per
 *     spec §7 + AC (i)).
 *
 * S215 OQ2 (ratified by Liam in S215 kickoff): NO Enter binding on
 * Approve & publish. The button responds to click only. Approve is a
 * high-stakes action and the spec rejects implicit keyboard activation
 * to prevent accidental publishes.
 *
 * AC (j): Editor role can see all three buttons. The PATCH route returns
 * 403 from the role-gate matrix in `lib/governance/publication-transitions.ts`
 * for non-admin transitions out of `'in_review'` — the UI surfaces 403 as
 * a `sonner` toast WITHOUT client-side button hide (graceful server-driven
 * gate per spec §7).
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §7, §8 (g)/(h)/(i)/(j).
 */

interface PublicationReviewActionBarProps {
  itemId: string;
  className?: string;
}

interface PatchResponse {
  success: boolean;
  previousStatus: string;
  newStatus: string;
  transition: string;
}

export function PublicationReviewActionBar({
  itemId,
  className,
}: PublicationReviewActionBarProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation<PatchResponse, ApiError, 'published' | 'draft'>({
    mutationFn: async (target) =>
      mutationFetchJson<PatchResponse>(
        `/api/items/${itemId}`,
        {
          field: 'publication_status',
          value: target,
        },
        { method: 'PATCH' },
      ),
    onSuccess: (_data, target) => {
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
      // Spec §7 / AC (j): no client-side button hide. Surface server gate
      // as a toast so editors see why their click had no effect.
      if (err.status === 403) {
        toast.error(
          'Approval is admin-only. Ask an admin to publish this item.',
        );
      } else if (err.status === 409) {
        toast.error(
          'The item state has changed. Refresh the queue and try again.',
        );
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
            opens in a new tab. Spec §7 + AC (i). */}
        <Link
          href={`/item/${itemId}`}
          aria-label="Open this item in the editor"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Open in editor
        </Link>
      </Button>
    </div>
  );
}
