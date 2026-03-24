'use client';

import { useState, useCallback, useRef } from 'react';
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
// Hook
// ---------------------------------------------------------------------------

export function useQuickReview(options?: UseQuickReviewOptions) {
  const { onOptimisticUpdate } = options ?? {};

  // Pending state: use ref for the map, state counter to force re-renders
  const pendingMapRef = useRef<Map<string, QuickReviewAction>>(new Map());
  const [, setPendingCounter] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const setPending = useCallback((itemId: string, action: QuickReviewAction) => {
    pendingMapRef.current.set(itemId, action);
    setPendingCounter((c) => c + 1);
  }, []);

  const clearPending = useCallback((itemId: string) => {
    pendingMapRef.current.delete(itemId);
    setPendingCounter((c) => c + 1);
  }, []);

  const isPending = useCallback((itemId: string): boolean => {
    return pendingMapRef.current.has(itemId);
  }, []);

  /** Generic API call to POST /api/review/action */
  const callReviewAction = useCallback(
    async (
      itemId: string,
      action: string,
      flagDetails?: string,
    ): Promise<boolean> => {
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
    [],
  );

  // --- quickUnverify ---
  // Defined before quickVerify so it can be referenced in the undo callback
  const quickUnverify = useCallback(
    async (itemId: string, itemTitle: string) => {
      setError(null);
      setPending(itemId, 'unverify');

      // Optimistic update
      onOptimisticUpdate?.(itemId, { verified_at: null });

      const ok = await callReviewAction(itemId, 'unverify');

      clearPending(itemId);

      if (!ok) {
        // Rollback: restore verified state
        onOptimisticUpdate?.(itemId, { verified_at: new Date().toISOString() });
        setError('Action failed');
        toast.error('Action failed. Check your connection and try again.');
        return;
      }

      toast.success(`Unverified: ${itemTitle}`);
    },
    [onOptimisticUpdate, setPending, clearPending, callReviewAction],
  );

  // --- quickVerify ---
  const quickVerify = useCallback(
    async (itemId: string, itemTitle: string) => {
      setError(null);
      setPending(itemId, 'verify');

      // Optimistic update
      const verifiedAt = new Date().toISOString();
      onOptimisticUpdate?.(itemId, { verified_at: verifiedAt });

      const ok = await callReviewAction(itemId, 'verify');

      clearPending(itemId);

      if (!ok) {
        // Rollback
        onOptimisticUpdate?.(itemId, { verified_at: null });
        setError('Action failed');
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
    [onOptimisticUpdate, setPending, clearPending, callReviewAction, quickUnverify],
  );

  // --- quickUnflag ---
  // Defined before quickFlag so it can be referenced in the undo callback
  const quickUnflag = useCallback(
    async (itemId: string, itemTitle: string) => {
      setError(null);
      setPending(itemId, 'unflag');

      // Optimistic update
      onOptimisticUpdate?.(itemId, { hasQualityFlag: false });

      const ok = await callReviewAction(itemId, 'unflag');

      clearPending(itemId);

      if (!ok) {
        // Rollback
        onOptimisticUpdate?.(itemId, { hasQualityFlag: true });
        setError('Action failed');
        toast.error('Action failed. Check your connection and try again.');
        return;
      }

      toast.success(`Unflagged: ${itemTitle}`);
    },
    [onOptimisticUpdate, setPending, clearPending, callReviewAction],
  );

  // --- quickFlag ---
  const quickFlag = useCallback(
    async (itemId: string, itemTitle: string, reason?: string) => {
      setError(null);
      setPending(itemId, 'flag');

      // Optimistic update: flagging clears verification
      onOptimisticUpdate?.(itemId, { verified_at: null, hasQualityFlag: true });

      const ok = await callReviewAction(
        itemId,
        'flag',
        reason?.trim() || undefined,
      );

      clearPending(itemId);

      if (!ok) {
        // Rollback
        onOptimisticUpdate?.(itemId, { hasQualityFlag: false });
        setError('Action failed');
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
    [onOptimisticUpdate, setPending, clearPending, callReviewAction, quickUnflag],
  );

  return {
    error,
    pendingItems: pendingMapRef.current,
    quickVerify,
    quickUnverify,
    quickFlag,
    quickUnflag,
    isPending,
  } satisfies QuickReviewState & {
    pendingItems: Map<string, QuickReviewAction>;
    quickVerify: (itemId: string, itemTitle: string) => Promise<void>;
    quickUnverify: (itemId: string, itemTitle: string) => Promise<void>;
    quickFlag: (itemId: string, itemTitle: string, reason?: string) => Promise<void>;
    quickUnflag: (itemId: string, itemTitle: string) => Promise<void>;
    isPending: (itemId: string) => boolean;
  };
}
