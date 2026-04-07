'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuickReviewAction = 'verify' | 'unverify' | 'flag' | 'unflag';

export type OnOptimisticUpdate = (
  itemId: string,
  updates: Partial<{
    verified_at: string | null;
    hasQualityFlag: boolean;
  }>,
) => void;

export interface UseQuickReviewOptions {
  /**
   * Callback invoked immediately (before API call) with the optimistic field
   * changes. The parent component uses this to update its local state.
   */
  onOptimisticUpdate?: OnOptimisticUpdate;
}

interface QuickReviewState {
  /** Most recent error, if any */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Mutation variable types
// ---------------------------------------------------------------------------

interface ReviewActionVariables {
  itemId: string;
  itemTitle: string;
  action: QuickReviewAction;
  flagDetails?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useQuickReview(options?: UseQuickReviewOptions) {
  const { onOptimisticUpdate } = options ?? {};
  const queryClient = useQueryClient();

  // Per-item pending state (Map itemId → action). State (not ref) so that
  // updates trigger re-renders and React Compiler can track them. Tracks
  // which specific action is pending per item — more granular than
  // useMutation.isPending which is a single boolean.
  const [pendingItems, setPendingItems] = useState<
    Map<string, QuickReviewAction>
  >(() => new Map());

  const setPending = useCallback(
    (itemId: string, action: QuickReviewAction) => {
      setPendingItems((prev) => {
        const next = new Map(prev);
        next.set(itemId, action);
        return next;
      });
    },
    [],
  );

  const clearPending = useCallback((itemId: string) => {
    setPendingItems((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const isPending = useCallback(
    (itemId: string): boolean => pendingItems.has(itemId),
    [pendingItems],
  );

  // -------------------------------------------------------------------------
  // Unified review action mutation
  // -------------------------------------------------------------------------

  const reviewActionMutation = useMutation<
    boolean,
    Error,
    ReviewActionVariables
  >({
    mutationFn: async ({ itemId, action, flagDetails }) => {
      const body: Record<string, unknown> = { item_id: itemId, action };
      if (flagDetails) {
        body.flag_details = flagDetails;
      }

      const res = await fetch('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      return res.ok;
    },
    onSuccess: (ok) => {
      if (!ok) return;
      // Invalidate review stats and quality flag caches so other components
      // reflect the updated state
      queryClient.invalidateQueries({ queryKey: queryKeys.review.stats });
      queryClient.invalidateQueries({
        queryKey: queryKeys.qualityFlags.flaggedIds,
      });
    },
  });

  // -------------------------------------------------------------------------
  // Destructure stable mutateAsync from the mutation object
  // -------------------------------------------------------------------------

  const { mutateAsync: reviewActionMutateAsync } = reviewActionMutation;

  // -------------------------------------------------------------------------
  // Action helpers — preserve exact original signatures
  // -------------------------------------------------------------------------

  // --- quickUnverify ---
  // Defined before quickVerify so it can be referenced in the undo callback
  const quickUnverify = useCallback(
    async (itemId: string, itemTitle: string) => {
      setPending(itemId, 'unverify');

      // Optimistic update
      onOptimisticUpdate?.(itemId, { verified_at: null });

      const ok = await reviewActionMutateAsync({
        itemId,
        itemTitle,
        action: 'unverify',
      });

      clearPending(itemId);

      if (!ok) {
        // Rollback: restore verified state
        onOptimisticUpdate?.(itemId, { verified_at: new Date().toISOString() });
        toast.error('Action failed. Check your connection and try again.');
        return;
      }

      toast.success(`Unverified: ${itemTitle}`);
    },
    [onOptimisticUpdate, setPending, clearPending, reviewActionMutateAsync],
  );

  // --- quickVerify ---
  const quickVerify = useCallback(
    async (itemId: string, itemTitle: string) => {
      setPending(itemId, 'verify');

      // Optimistic update
      const verifiedAt = new Date().toISOString();
      onOptimisticUpdate?.(itemId, { verified_at: verifiedAt });

      const ok = await reviewActionMutateAsync({
        itemId,
        itemTitle,
        action: 'verify',
      });

      clearPending(itemId);

      if (!ok) {
        // Rollback
        onOptimisticUpdate?.(itemId, { verified_at: null });
        toast.error('Action failed. Check your connection and try again.');
        return;
      }

      toast.success(`Verified: ${itemTitle}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => quickUnverify(itemId, itemTitle),
        },
      });
    },
    [
      onOptimisticUpdate,
      setPending,
      clearPending,
      reviewActionMutateAsync,
      quickUnverify,
    ],
  );

  // --- quickUnflag ---
  // Defined before quickFlag so it can be referenced in the undo callback
  const quickUnflag = useCallback(
    async (itemId: string, itemTitle: string) => {
      setPending(itemId, 'unflag');

      // Optimistic update
      onOptimisticUpdate?.(itemId, { hasQualityFlag: false });

      const ok = await reviewActionMutateAsync({
        itemId,
        itemTitle,
        action: 'unflag',
      });

      clearPending(itemId);

      if (!ok) {
        // Rollback
        onOptimisticUpdate?.(itemId, { hasQualityFlag: true });
        toast.error('Action failed. Check your connection and try again.');
        return;
      }

      toast.success(`Unflagged: ${itemTitle}`);
    },
    [onOptimisticUpdate, setPending, clearPending, reviewActionMutateAsync],
  );

  // --- quickFlag ---
  const quickFlag = useCallback(
    async (itemId: string, itemTitle: string, reason?: string) => {
      setPending(itemId, 'flag');

      // Optimistic update: flagging clears verification
      onOptimisticUpdate?.(itemId, { verified_at: null, hasQualityFlag: true });

      const ok = await reviewActionMutateAsync({
        itemId,
        itemTitle,
        action: 'flag',
        flagDetails: reason?.trim() || undefined,
      });

      clearPending(itemId);

      if (!ok) {
        // Rollback
        onOptimisticUpdate?.(itemId, { hasQualityFlag: false });
        toast.error('Action failed. Check your connection and try again.');
        return;
      }

      toast.success(`Flagged: ${itemTitle}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => quickUnflag(itemId, itemTitle),
        },
      });
    },
    [
      onOptimisticUpdate,
      setPending,
      clearPending,
      reviewActionMutateAsync,
      quickUnflag,
    ],
  );

  // Derive error from the last mutation error
  const error = reviewActionMutation.error?.message ?? null;

  return {
    error,
    pendingItems,
    quickVerify,
    quickUnverify,
    quickFlag,
    quickUnflag,
    isPending,
  } satisfies QuickReviewState & {
    pendingItems: Map<string, QuickReviewAction>;
    quickVerify: (itemId: string, itemTitle: string) => Promise<void>;
    quickUnverify: (itemId: string, itemTitle: string) => Promise<void>;
    quickFlag: (
      itemId: string,
      itemTitle: string,
      reason?: string,
    ) => Promise<void>;
    quickUnflag: (itemId: string, itemTitle: string) => Promise<void>;
    isPending: (itemId: string) => boolean;
  };
}
