'use client';

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query/query-keys';
import {
  fetchPublicationReviewQueue,
  mutationBulkPublicationAction,
  type PublicationBulkActionResponse,
  type PublicationReviewQueueFilters,
  ApiError,
} from '@/lib/query/fetchers';
import { Checkbox } from '@/components/ui/checkbox';
import { PublicationReviewCard } from '@/components/review/publication-review-card';
import { PublicationReviewActionBar } from '@/components/review/publication-review-action-bar';
import { PublicationBulkActionBar } from '@/components/review/publication-bulk-action-bar';
import { PublicationBulkResultDialog } from '@/components/review/publication-bulk-result-dialog';
import { usePublicationReviewSelection } from '@/hooks/review/use-publication-review-selection';
import type { ReviewQueueItem } from '@/types/review';

/**
 * Tab 6 of /review — "Awaiting publication" queue.
 *
 * Calls `GET /api/review/queue?publication_status=in_review` via TanStack
 * Query (per CLAUDE.md "Data fetching: TanStack Query exclusively"). Each
 * row renders as `<PublicationReviewCard>` paired with a
 * `<PublicationReviewActionBar>` (NOT folded into the card so the action
 * set stays swappable per spec §7).
 *
 * Empty-state copy is fixed by spec §7 to: "No items awaiting publication.
 * EP2 markdown ingests + bulk approval (§5.3) feed this queue."
 *
 * Stable empty default (CLAUDE.md G14): `EMPTY_ITEMS` is a module-level
 * const so the `useMemo` pulling items off the response keeps a stable
 * identity when the response is null/undefined.
 *
 * Deep-link URL params (V_W1 Finding 1 fix). Spec §5 third bullet:
 * "Pasting `/review?tab=publication-review&domain=technical` lands on the
 * tab with the domain filter pre-applied." Reads `domain`, `content_type`,
 * `source_file`, `source_document_id` from `useSearchParams()` and forwards
 * them BOTH into the fetcher and the query key so the cache shards per
 * filter combination (matching the fetcher signature widening).
 *
 * S220 W1a (publication-approval-gate spec §3, §8 AC-bulk-4.x): the queue
 * also owns page-scoped multi-select state for bulk approve / bulk
 * return-to-draft. Selection lives in
 * `usePublicationReviewSelection()` (page-scoped, ephemeral — tab-switch
 * unmounts the queue and clears state per spec §3.1). On any selection
 * size >= 1 the bulk action bar mounts above the `<ul>`. The bulk
 * mutation calls `POST /api/review/publication-bulk-action` via
 * `mutationBulkPublicationAction()` (NOT a per-row PATCH loop), then
 * invalidates the queue + stats + per-item detail cache, clears the
 * selection set, and surfaces a `sonner` toast keyed on the
 * partial-failure shape (all-success / mixed / all-failed per spec §3.4).
 *
 * Spec: docs/specs/review-page-tabs-refactor-spec.md §5, §7, §8 (f);
 *       docs/specs/publication-approval-gate-spec.md v1 §3 + §8 AC-bulk-4.x.
 */

const EMPTY_ITEMS: ReviewQueueItem[] = [];

interface BulkResultDialogState {
  open: boolean;
  response: PublicationBulkActionResponse | null;
}

const INITIAL_DIALOG_STATE: BulkResultDialogState = {
  open: false,
  response: null,
};

export function PublicationReviewQueue() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  // Parse the URL filters. Both `domain` and `content_type` accept either
  // repeated keys (`?domain=a&domain=b`) or comma-separated (`?domain=a,b`),
  // mirroring the standard /api/review/queue route helper. The result is
  // memoised so both the query key (cache shard) and the fetcher receive a
  // stable reference per searchParams change.
  const filters = useMemo<PublicationReviewQueueFilters>(() => {
    const domainValues = searchParams
      .getAll('domain')
      .flatMap((v) => v.split(','))
      .filter(Boolean);
    const contentTypeValues = searchParams
      .getAll('content_type')
      .flatMap((v) => v.split(','))
      .filter(Boolean);
    const sourceFile = searchParams.get('source_file');
    const sourceDocumentId = searchParams.get('source_document_id');

    const result: PublicationReviewQueueFilters = {};
    if (domainValues.length > 0) result.domain = domainValues;
    if (contentTypeValues.length > 0) result.content_type = contentTypeValues;
    if (sourceFile) result.source_file = sourceFile;
    if (sourceDocumentId) result.source_document_id = sourceDocumentId;
    return result;
  }, [searchParams]);

  const { data, isLoading, isError, error } = useQuery({
    // Cast to Record<string, unknown> for the query-key factory which
    // accepts the broader index-signature shape; PublicationReviewQueueFilters
    // is an interface with optional named keys (no index signature). The
    // cache shards on JSON-serialised filter object so any structurally
    // equivalent shape is fine.
    queryKey: queryKeys.review.publicationReviewQueue(
      filters as Record<string, unknown>,
    ),
    queryFn: () => fetchPublicationReviewQueue(filters),
  });

  const items = useMemo<ReviewQueueItem[]>(
    () => data?.items ?? EMPTY_ITEMS,
    [data?.items],
  );

  // Selection state — page-scoped, ephemeral. Spec §3.1.
  const { selectedIds, isSelected, toggle, selectAll, clear } =
    usePublicationReviewSelection();

  // Map of selected id -> title for the result-dialog (so per-item failures
  // can be rendered with human-readable titles, not raw UUIDs). Recomputed
  // from `items` (current page) — stable identity per render cycle.
  const itemTitleLookup = useMemo(
    () => new Map(items.map((i) => [i.id, i.title])),
    [items],
  );

  const [dialogState, setDialogState] = useState<BulkResultDialogState>(
    INITIAL_DIALOG_STATE,
  );

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogState((prev) => ({ ...prev, open }));
  }, []);

  // Bulk mutation. Spec §3.4 step 1-5:
  //   1. Invalidate publicationReviewQueue() so the queue refetches and
  //      successful rows drop out.
  //   2. Invalidate stats so the tab badge count updates.
  //   3. Invalidate contentItems.detail(itemId) for each successfully-
  //      transitioned id (mirrors per-row action bar pattern at
  //      `publication-review-action-bar.tsx:71-77`).
  //   4. Clear the selection set.
  //   5. Surface a sonner toast keyed on the partial-failure shape.
  const bulkMutation = useMutation<
    PublicationBulkActionResponse,
    ApiError,
    'approve' | 'return_to_draft'
  >({
    mutationFn: (action) =>
      mutationBulkPublicationAction({
        ids: Array.from(selectedIds),
        action,
      }),
    onSuccess: (response) => {
      // Step 1 + 2 — queue + stats invalidations always happen, even on
      // all-failed responses, so the UI re-syncs against server state.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.review.publicationReviewQueue(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.review.stats,
      });

      // Step 3 — invalidate per-item detail caches only for
      // successfully-transitioned rows (mirrors per-row pattern).
      for (const result of response.results) {
        if (result.status === 'success') {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.contentItems.detail(result.id),
          });
        }
      }

      // Step 4 — clear selection.
      clear();

      // Step 5 — toast variants per spec §3.4. Open the result dialog when
      // there's at least one failure so users can see per-item outcomes.
      const { successCount, failureCount, totalRequested, action } = response;
      const verbed = action === 'approve' ? 'published' : 'returned to draft';

      if (failureCount === 0) {
        const noun = successCount === 1 ? 'item' : 'items';
        toast.success(`${successCount} ${noun} ${verbed}.`);
        return;
      }

      if (successCount === 0) {
        toast.error(
          `Could not process any of the ${totalRequested} selected items.`,
        );
        setDialogState({ open: true, response });
        return;
      }

      // Mixed — both successes and failures. Spec §3.4 prescribes a "View
      // details" affordance that opens the result dialog. Sonner accepts
      // an `action` slot that surfaces a button on the toast — clicking it
      // opens the per-item-failure dialog.
      toast.warning(
        `${successCount} of ${totalRequested} items ${verbed}. ${failureCount} could not be processed — see details.`,
        {
          action: {
            label: 'View details',
            onClick: () => setDialogState({ open: true, response }),
          },
        },
      );
    },
    onError: (err) => {
      // Route-level failure (auth, rate-limit, validation, 5xx). Per-item
      // failures resolve into the success branch with structured
      // `results[]` — they never reach onError.
      if (err.status === 403) {
        toast.error(
          'Bulk action is admin-only. Ask an admin to publish these items.',
        );
      } else if (err.status === 429) {
        toast.error(
          'Too many bulk actions in a short window. Wait a moment and try again.',
        );
      } else {
        toast.error(err.message || 'Bulk action failed. Please try again.');
      }
    },
  });

  const { mutate: bulkMutate } = bulkMutation;

  const handleApprove = useCallback(() => {
    bulkMutate('approve');
  }, [bulkMutate]);

  const handleReturnToDraft = useCallback(() => {
    bulkMutate('return_to_draft');
  }, [bulkMutate]);

  // Page-id list for the master "Select all on page" checkbox. Stable
  // reference per `items` change so the bar's onSelectAllOnPage callback
  // doesn't churn.
  const pageItemIds = useMemo(() => items.map((i) => i.id), [items]);

  const handleSelectAllOnPage = useCallback(() => {
    selectAll(pageItemIds);
  }, [selectAll, pageItemIds]);

  // Loading skeleton — mirrors the standard review-queue skeleton shape so
  // tab switches don't visually jolt.
  if (isLoading) {
    return (
      <section
        aria-label="Awaiting publication — loading"
        className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6"
      >
        <div role="status" aria-label="Loading awaiting-publication queue">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="mb-4 rounded-xl border border-border bg-card p-5"
            >
              <div className="h-5 w-32 animate-pulse rounded-full bg-accent" />
              <div className="mt-3 h-6 w-3/4 animate-pulse rounded bg-accent" />
              <div className="mt-4 space-y-2">
                <div className="h-4 w-full animate-pulse rounded bg-accent" />
                <div className="h-4 w-full animate-pulse rounded bg-accent" />
                <div className="h-4 w-4/6 animate-pulse rounded bg-accent" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (isError) {
    return (
      <section
        aria-label="Awaiting publication — error"
        className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6"
      >
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm text-destructive">
          <p className="font-medium">Failed to load awaiting-publication queue.</p>
          <p className="mt-1 text-xs">
            {error instanceof Error ? error.message : 'Unknown error'}
          </p>
        </div>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section
        aria-label="Awaiting publication — empty"
        className="mx-auto w-full max-w-[800px] px-4 py-12 sm:px-6"
      >
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-16 text-center">
          <ClipboardList
            className="size-10 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="mt-4 text-lg font-semibold">
            No items awaiting publication.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            EP2 markdown ingests + bulk approval (§5.3) feed this queue.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={`Awaiting publication — ${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6"
    >
      {selectedIds.size >= 1 && (
        <PublicationBulkActionBar
          selectedIds={selectedIds}
          pageItemCount={items.length}
          onSelectAllOnPage={handleSelectAllOnPage}
          onClearSelection={clear}
          onApprove={handleApprove}
          onReturnToDraft={handleReturnToDraft}
          isPending={bulkMutation.isPending}
        />
      )}

      <ul className="flex flex-col gap-4" role="list">
        {items.map((item) => (
          <li key={item.id} className="rounded-xl border border-border bg-card">
            <div className="flex items-start gap-3 p-3">
              <Checkbox
                checked={isSelected(item.id)}
                onCheckedChange={() => toggle(item.id)}
                aria-label={`Select ${item.title} for bulk action`}
              />
              <div className="flex-1">
                <PublicationReviewCard item={item} className="border-0 shadow-none" />
                <PublicationReviewActionBar itemId={item.id} />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <PublicationBulkResultDialog
        open={dialogState.open}
        onOpenChange={handleDialogOpenChange}
        response={dialogState.response}
        itemTitleLookup={itemTitleLookup}
      />
    </section>
  );
}
