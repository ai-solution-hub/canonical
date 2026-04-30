'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Merge, SkipForward } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ApiError,
  postAdminNearDupConfirmUnique,
  postAdminNearDupMerge,
  type NearDupPairMember,
} from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import { NearDuplicatesMergeDirectionDialog } from './near-duplicates-merge-direction-dialog';

interface NearDuplicatesActionButtonsProps {
  pairId: string;
  left: NearDupPairMember;
  right: NearDupPairMember;
  /**
   * Similarity score currently shown in the detail header (from the
   * pair-detail query). Forwarded to the merge / confirm-unique routes
   * as OQ2 audit context (`similarity_at_resolution`).
   */
  similarity: number;
  /**
   * Filter threshold the admin had active when they navigated into the
   * detail view. Forwarded to the routes as OQ2 audit context
   * (`threshold_at_resolution`).
   */
  threshold: number;
}

const NOTE_MAX_LENGTH = 500;

/**
 * Three resolution actions for the §1.9 detail view.
 *
 *  - **Merge** opens the {@link NearDuplicatesMergeDirectionDialog}; the
 *    dialog computes the default direction heuristic and on confirm
 *    POSTs to the merge endpoint with the chosen `oldId`/`newId`.
 *  - **Confirm unique** POSTs to the confirm-unique endpoint, which
 *    flips both rows to `confirmed_unique`.
 *  - **Defer** is UI-only — no API call. We invalidate the list cache
 *    and route back to the list view.
 *
 * No optimistic updates (per spec §6.4) — mutations run, invalidate, and
 * route back. 409 responses are handled gracefully (toast + route back;
 * the pair was already resolved by another admin or has advanced to a
 * terminal state).
 *
 * Spec: docs/specs/§1.9-near-dup-merge-dashboard-spec.md §6.2.
 */
export function NearDuplicatesActionButtons({
  pairId,
  left,
  right,
  similarity,
  threshold,
}: NearDuplicatesActionButtonsProps) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [note, setNote] = useState('');
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);

  const invalidateAndRoute = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminNearDup.all });
    router.push('/admin/content-dedup/near-duplicates');
  };

  const handleApiError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 409) {
      toast.error('Pair already resolved');
      invalidateAndRoute();
      return;
    }
    toast.error(err instanceof Error ? err.message : fallback);
  };

  const trimmedNote = note.trim().length > 0 ? note.trim() : undefined;

  const merge = useMutation({
    mutationFn: (params: { oldId: string; newId: string; note?: string }) =>
      postAdminNearDupMerge(pairId, {
        oldId: params.oldId,
        newId: params.newId,
        ...(params.note ? { note: params.note } : {}),
        similarity_at_resolution: similarity,
        threshold_at_resolution: threshold,
      }),
    onSuccess: () => {
      toast.success('Merged — loser row marked superseded');
      setMergeDialogOpen(false);
      invalidateAndRoute();
    },
    onError: (err) => handleApiError(err, 'Failed to merge pair'),
  });

  const confirmUnique = useMutation({
    mutationFn: (n: string | undefined) =>
      postAdminNearDupConfirmUnique(pairId, {
        ...(n ? { note: n } : {}),
        similarity_at_resolution: similarity,
        threshold_at_resolution: threshold,
      }),
    onSuccess: () => {
      toast.success('Pair confirmed unique — both rows kept live');
      invalidateAndRoute();
    },
    onError: (err) => handleApiError(err, 'Failed to confirm unique'),
  });

  const isMutating = merge.isPending || confirmUnique.isPending;

  const handleDefer = () => {
    // Defer is UI-only — no DB write. Pair re-appears on next dashboard
    // load (per spec §1.1, §6.2). Invalidate so the list refreshes.
    queryClient.invalidateQueries({ queryKey: queryKeys.adminNearDup.all });
    router.push('/admin/content-dedup/near-duplicates');
  };

  return (
    <section
      aria-labelledby="near-dup-resolution-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="near-dup-resolution-heading" className="text-sm font-semibold">
        Resolution
      </h2>

      <div className="mt-3">
        <label
          htmlFor="near-dup-note"
          className="text-xs font-medium text-muted-foreground"
        >
          Note (optional, max {NOTE_MAX_LENGTH} chars)
        </label>
        <textarea
          id="near-dup-note"
          value={note}
          onChange={(event) => {
            const next = event.target.value;
            if (next.length <= NOTE_MAX_LENGTH) setNote(next);
          }}
          maxLength={NOTE_MAX_LENGTH}
          rows={2}
          disabled={isMutating}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder="Optional context for the audit trail."
          data-testid="near-dup-note-input"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground tabular-nums">
          {note.length} / {NOTE_MAX_LENGTH}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => setMergeDialogOpen(true)}
          disabled={isMutating}
          data-testid="near-dup-merge-trigger"
        >
          {merge.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Merge className="size-4" aria-hidden="true" />
          )}
          Merge…
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => confirmUnique.mutate(trimmedNote)}
          disabled={isMutating}
          data-testid="near-dup-confirm-unique"
        >
          {confirmUnique.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" aria-hidden="true" />
          )}
          Confirm both unique
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleDefer}
          disabled={isMutating}
          data-testid="near-dup-defer"
        >
          <SkipForward className="size-4" aria-hidden="true" />
          Defer
        </Button>
      </div>

      <NearDuplicatesMergeDirectionDialog
        open={mergeDialogOpen}
        onOpenChange={setMergeDialogOpen}
        left={left}
        right={right}
        note={trimmedNote}
        isPending={merge.isPending}
        onConfirm={(params) => merge.mutate(params)}
      />
    </section>
  );
}
