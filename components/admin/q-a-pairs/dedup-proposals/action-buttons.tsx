'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Merge, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  ApiError,
  postAdminQaDedupApprove,
  postAdminQaDedupReject,
  type QaDedupPairMember,
} from '@/lib/query/fetchers';
import { queryKeys } from '@/lib/query/query-keys';
import { SurvivorOverrideDialog } from './survivor-override-dialog';

interface QaDedupActionButtonsProps {
  proposalId: string;
  pairA: QaDedupPairMember;
  pairB: QaDedupPairMember;
  /** The proposer's nominated survivor id — the dialog's initial selection. */
  proposedSurvivorId: string;
}

/**
 * Per-pair approve / reject actions for the ID-120 {120.8} dedup detail view
 * (TECH P-4 / INV-13/17/18).
 *
 *  - **Approve** opens the {@link SurvivorOverrideDialog} — it is NEVER
 *    pre-selected nor pre-fired (INV-17). The curator confirms the survivor in
 *    the dialog, then the mutation POSTs to the {120.7} approve route.
 *  - **Reject** POSTs to the {120.7} reject route (no q_a_pairs write).
 *
 * No optimistic updates — mutations run, invalidate the queue, and route back
 * to the list. A 409 (concurrent resolve / already-archived) is handled
 * gracefully (toast + route back).
 */
export function QaDedupActionButtons({
  proposalId,
  pairA,
  pairB,
  proposedSurvivorId,
}: QaDedupActionButtonsProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);

  const invalidateAndRoute = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.adminQaDedup.all });
    router.push('/admin/q-a-pairs/dedup-proposals');
  };

  const handleApiError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.status === 409) {
      toast.error('Proposal already resolved');
      invalidateAndRoute();
      return;
    }
    toast.error(err instanceof Error ? err.message : fallback);
  };

  const approve = useMutation({
    mutationFn: (survivorId: string) =>
      postAdminQaDedupApprove(proposalId, { survivorId }),
    onSuccess: () => {
      toast.success('Approved — non-survivor archived');
      setDialogOpen(false);
      invalidateAndRoute();
    },
    onError: (err) => handleApiError(err, 'Failed to approve proposal'),
  });

  const reject = useMutation({
    mutationFn: () => postAdminQaDedupReject(proposalId),
    onSuccess: () => {
      toast.success('Rejected — both pairs kept');
      invalidateAndRoute();
    },
    onError: (err) => handleApiError(err, 'Failed to reject proposal'),
  });

  const isMutating = approve.isPending || reject.isPending;

  return (
    <section
      aria-labelledby="qa-dedup-resolution-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="qa-dedup-resolution-heading" className="text-sm font-semibold">
        Resolution
      </h2>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="default"
          size="sm"
          onClick={() => setDialogOpen(true)}
          disabled={isMutating}
          data-testid="qa-dedup-approve-trigger"
        >
          {approve.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Merge className="size-4" aria-hidden="true" />
          )}
          Approve…
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => reject.mutate()}
          disabled={isMutating}
          data-testid="qa-dedup-reject"
        >
          {reject.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <X className="size-4" aria-hidden="true" />
          )}
          Reject
        </Button>

        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="size-3.5" aria-hidden="true" />
          Approve opens a survivor confirmation step.
        </span>
      </div>

      <SurvivorOverrideDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        pairA={pairA}
        pairB={pairB}
        proposedSurvivorId={proposedSurvivorId}
        isPending={approve.isPending}
        onConfirm={(survivorId) => approve.mutate(survivorId)}
      />
    </section>
  );
}
