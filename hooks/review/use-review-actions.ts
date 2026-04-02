'use client';

import { useState, useCallback, useRef } from 'react';
import {
  useMutation,
  type QueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query/query-keys';
import { mutationFetchJson } from '@/lib/query/fetchers';
import type { ReviewQueueItem, ReviewProgress } from '@/types/review';
import type { ReviewQueuePage } from '@/hooks/review/use-review-queue-data';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UndoableAction {
  itemId: string;
  itemTitle: string;
  action: 'verify' | 'flag';
  previousIndex: number;
}

export interface UseReviewActionsParams {
  queue: ReviewQueueItem[];
  currentIndex: number;
  currentItem: ReviewQueueItem | null;
  queueFiltersKey: Record<string, unknown>;
  queryClient: QueryClient;
  progress: ReviewProgress;
  setProgress: React.Dispatch<React.SetStateAction<ReviewProgress>>;
  advanceToNext: () => void;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
}

export interface UseReviewActionsReturn {
  handleVerify: (note?: string) => Promise<void>;
  handlePublish: () => Promise<void>;
  handleFlagSubmit: (details?: string) => Promise<void>;
  isActioning: boolean;
  lastAnnouncement: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type InfiniteQueueData = InfiniteData<ReviewQueuePage, number>;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * All review mutations: verify, flag, publish, undo. Uses TanStack Query
 * useMutation with optimistic updates and automatic cache rollback on error.
 *
 * Toast fires pre-mutate (S126 finding #2) to preserve instant feedback UX.
 * Announcements are generated internally and exposed via `lastAnnouncement`.
 */
export function useReviewActions(
  params: UseReviewActionsParams,
): UseReviewActionsReturn {
  const {
    queue,
    currentIndex,
    currentItem,
    queueFiltersKey,
    queryClient,
    progress,
    setProgress,
    advanceToNext,
    setCurrentIndex,
  } = params;

  // Track last action for undo (setter only — not exposed beyond undo toast)
  const [, setLastAction] = useState<UndoableAction | null>(null);

  // Flagged items tracking (for context summary)
  const flaggedThisSessionRef = useRef<Set<string>>(new Set());

  // Last announcement for the orchestrator to sync into session state
  const [lastAnnouncement, setLastAnnouncement] = useState('');

  const queueQueryKey = queryKeys.review.queue(queueFiltersKey);

  // -----------------------------------------------------------------------
  // Undo mutation
  // -----------------------------------------------------------------------

  const undoMutation = useMutation({
    mutationFn: async ({
      itemId,
      action,
    }: {
      itemId: string;
      action: 'unverify' | 'unflag';
    }) =>
      mutationFetchJson('/api/review/action', {
        item_id: itemId,
        action,
      }),
    onMutate: async ({ itemId, action }) => {
      await queryClient.cancelQueries({ queryKey: queueQueryKey });
      const snapshot =
        queryClient.getQueryData<InfiniteQueueData>(queueQueryKey);
      const prevProgress = { ...progress };

      // Roll back progress
      setProgress((prev) => ({
        ...prev,
        verified:
          action === 'unverify'
            ? Math.max(0, prev.verified - 1)
            : prev.verified,
        flagged:
          action === 'unflag' ? Math.max(0, prev.flagged - 1) : prev.flagged,
        sessionReviewed: Math.max(0, prev.sessionReviewed - 1),
      }));

      // Roll back queue state if unverify
      if (action === 'unverify') {
        queryClient.setQueryData<InfiniteQueueData>(queueQueryKey, (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  items: page.items.map((item) =>
                    item.id === itemId
                      ? { ...item, verified_at: null, verified_by: null }
                      : item,
                  ),
                })),
              }
            : old,
        );
      }

      return { snapshot, prevProgress };
    },
    onSuccess: (_data, { itemId }) => {
      // Find item title for the success toast
      const item = queue.find((q) => q.id === itemId);
      const title = item?.title ?? item?.suggested_title ?? 'Item';
      toast.success(`Undone: ${title}`);
      setLastAction(null);
    },
    onError: (_err, _vars, context) => {
      // Restore snapshot on failure
      if (context?.snapshot) {
        queryClient.setQueryData(queueQueryKey, context.snapshot);
      }
      if (context?.prevProgress) {
        setProgress(context.prevProgress);
      }
      toast.error('Failed to undo. Please try again.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.review.stats });
    },
  });

  // -----------------------------------------------------------------------
  // Verify mutation
  // -----------------------------------------------------------------------

  const verifyMutation = useMutation({
    mutationFn: async ({ itemId, note }: { itemId: string; note?: string }) =>
      mutationFetchJson('/api/review/action', {
        item_id: itemId,
        action: 'verify',
        ...(note ? { note } : {}),
      }),
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: queueQueryKey });
      const snapshot =
        queryClient.getQueryData<InfiniteQueueData>(queueQueryKey);
      const prevProgress = { ...progress };
      const prevIndex = currentIndex;

      const item = queue.find((q) => q.id === itemId);
      const wasAlreadyVerified = !!item?.verified_at;

      // Optimistic: update item in infinite cache
      queryClient.setQueryData<InfiniteQueueData>(queueQueryKey, (old) =>
        old
          ? {
              ...old,
              pages: old.pages.map((page) => ({
                ...page,
                items: page.items.map((i) =>
                  i.id === itemId
                    ? {
                        ...i,
                        verified_at: new Date().toISOString(),
                        verified_by: 'current-user',
                      }
                    : i,
                ),
              })),
            }
          : old,
      );

      setProgress((prev) => ({
        ...prev,
        verified: prev.verified + (wasAlreadyVerified ? 0 : 1),
        sessionReviewed: prev.sessionReviewed + 1,
      }));
      advanceToNext();

      return { snapshot, prevProgress, prevIndex, wasAlreadyVerified };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(queueQueryKey, context.snapshot);
      }
      if (context?.prevProgress) {
        setProgress(context.prevProgress);
      }
      if (context?.prevIndex !== undefined) {
        setCurrentIndex(context.prevIndex);
      }
      toast.error('Action failed. Check your connection and try again.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.review.stats });
    },
  });

  // -----------------------------------------------------------------------
  // Flag mutation
  // -----------------------------------------------------------------------

  const flagMutation = useMutation({
    mutationFn: async ({
      itemId,
      flagDetails,
    }: {
      itemId: string;
      flagDetails?: string;
    }) => {
      const body: Record<string, unknown> = {
        item_id: itemId,
        action: 'flag',
      };
      if (flagDetails?.trim()) {
        body.flag_details = flagDetails.trim();
      }
      return mutationFetchJson('/api/review/action', body);
    },
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: queueQueryKey });
      const snapshot =
        queryClient.getQueryData<InfiniteQueueData>(queueQueryKey);
      const prevProgress = { ...progress };
      const prevIndex = currentIndex;

      // Track flagged items
      flaggedThisSessionRef.current.add(itemId);

      setProgress((prev) => ({
        ...prev,
        flagged: prev.flagged + 1,
        sessionReviewed: prev.sessionReviewed + 1,
      }));
      advanceToNext();

      return { snapshot, prevProgress, prevIndex };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(queueQueryKey, context.snapshot);
      }
      if (context?.prevProgress) {
        setProgress(context.prevProgress);
      }
      if (context?.prevIndex !== undefined) {
        setCurrentIndex(context.prevIndex);
      }
      toast.error('Action failed. Check your connection and try again.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.review.stats });
    },
  });

  // -----------------------------------------------------------------------
  // Publish mutation
  // -----------------------------------------------------------------------

  const publishMutation = useMutation({
    mutationFn: async ({ itemId }: { itemId: string }) =>
      mutationFetchJson(
        `/api/items/${itemId}`,
        { field: 'governance_review_status', value: null },
        { method: 'PATCH' },
      ),
    onMutate: async ({ itemId }) => {
      await queryClient.cancelQueries({ queryKey: queueQueryKey });
      const snapshot =
        queryClient.getQueryData<InfiniteQueueData>(queueQueryKey);
      const prevIndex = currentIndex;

      // Optimistic: remove item from cache
      queryClient.setQueryData<InfiniteQueueData>(queueQueryKey, (old) => {
        if (!old) return old;
        const newPages = old.pages.map((page) => ({
          ...page,
          items: page.items.filter((i) => i.id !== itemId),
        }));
        return { ...old, pages: newPages };
      });

      // Clamp index to new bounds
      const totalItems = queue.filter((i) => i.id !== itemId).length;
      const maxIndex = Math.max(0, totalItems - 1);
      setCurrentIndex((idx) => Math.min(idx, maxIndex));

      return { snapshot, prevIndex };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) {
        queryClient.setQueryData(queueQueryKey, context.snapshot);
      }
      if (context?.prevIndex !== undefined) {
        setCurrentIndex(context.prevIndex);
      }
      toast.error('Failed to publish. Check your connection and try again.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.review.stats });
      queryClient.invalidateQueries({ queryKey: queryKeys.review.queue() });
    },
  });

  // -----------------------------------------------------------------------
  // Destructure stable mutate/mutateAsync functions from mutation objects
  // -----------------------------------------------------------------------

  const { mutateAsync: verifyMutateAsync, isPending: isVerifyPending } =
    verifyMutation;
  const { mutate: undoMutate } = undoMutation;
  const { mutateAsync: flagMutateAsync, isPending: isFlagPending } =
    flagMutation;
  const { mutateAsync: publishMutateAsync, isPending: isPublishPending } =
    publishMutation;

  // -----------------------------------------------------------------------
  // Handler wrappers — toast fires BEFORE mutate (S126 #2)
  // -----------------------------------------------------------------------

  const handleVerify = useCallback(
    async (note?: string) => {
      if (!currentItem || isVerifyPending) return;

      const itemTitle =
        currentItem.title ?? currentItem.suggested_title ?? 'Item';
      const wasAlreadyVerified = !!currentItem.verified_at;
      const isLastItem = currentIndex >= queue.length - 1;
      const nextDisplayPosition = isLastItem
        ? currentIndex + 1
        : currentIndex + 2;

      // Generate announcement
      setLastAnnouncement(
        isLastItem
          ? wasAlreadyVerified
            ? 'Re-verified. Last item in queue.'
            : 'Verified. Last item in queue.'
          : wasAlreadyVerified
            ? `Re-verified. Item ${nextDisplayPosition} of ${progress.total}. ${itemTitle}.`
            : `Verified. Item ${nextDisplayPosition} of ${progress.total}. ${itemTitle}.`,
      );

      // Undo action for the toast
      const undoAction: UndoableAction = {
        itemId: currentItem.id,
        itemTitle,
        action: 'verify',
        previousIndex: currentIndex,
      };
      setLastAction(undoAction);

      // Toast fires pre-mutate (S126 #2)
      toast.success(`Verified: ${itemTitle}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            undoMutate({
              itemId: undoAction.itemId,
              action: 'unverify',
            });
            setCurrentIndex(undoAction.previousIndex);
          },
        },
      });

      await verifyMutateAsync({
        itemId: currentItem.id,
        note,
      });
    },
    [
      currentItem,
      isVerifyPending,
      verifyMutateAsync,
      undoMutate,
      currentIndex,
      queue.length,
      progress.total,
      setCurrentIndex,
    ],
  );

  const handleFlagSubmit = useCallback(
    async (details?: string) => {
      if (!currentItem || isFlagPending) return;

      const itemTitle =
        currentItem.title ?? currentItem.suggested_title ?? 'Item';
      const isLastItem = currentIndex >= queue.length - 1;
      const nextDisplayPosition = isLastItem
        ? currentIndex + 1
        : currentIndex + 2;

      // Generate announcement
      setLastAnnouncement(
        isLastItem
          ? 'Flagged for review. Last item in queue.'
          : `Flagged for review. Item ${nextDisplayPosition} of ${progress.total}. ${itemTitle}.`,
      );

      // Undo action for the toast
      const undoAction: UndoableAction = {
        itemId: currentItem.id,
        itemTitle,
        action: 'flag',
        previousIndex: currentIndex,
      };
      setLastAction(undoAction);

      // Toast fires pre-mutate (S126 #2)
      toast.success(`Flagged: ${itemTitle}`, {
        duration: 5000,
        action: {
          label: 'Undo',
          onClick: () => {
            undoMutate({
              itemId: undoAction.itemId,
              action: 'unflag',
            });
            setCurrentIndex(undoAction.previousIndex);
          },
        },
      });

      await flagMutateAsync({
        itemId: currentItem.id,
        flagDetails: details,
      });
    },
    [
      currentItem,
      isFlagPending,
      flagMutateAsync,
      undoMutate,
      currentIndex,
      queue.length,
      progress.total,
      setCurrentIndex,
    ],
  );

  const handlePublish = useCallback(async () => {
    if (!currentItem || isPublishPending) return;
    if (currentItem.governance_review_status !== 'draft') return;

    const itemTitle =
      currentItem.title ?? currentItem.suggested_title ?? 'Item';

    // Toast fires pre-mutate
    toast.success(`Published: ${itemTitle}`);
    setLastAnnouncement(`Published. ${itemTitle} is now live.`);

    await publishMutateAsync({ itemId: currentItem.id });
  }, [currentItem, isPublishPending, publishMutateAsync]);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const isActioning = isVerifyPending || isFlagPending || isPublishPending;

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    handleVerify,
    handlePublish,
    handleFlagSubmit,
    isActioning,
    lastAnnouncement,
  };
}
