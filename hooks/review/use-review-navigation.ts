'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from '@tanstack/react-query';
import type { ReviewQueueItem } from '@/types/review';
import type { ReviewQueuePage } from '@/hooks/review/use-review-queue-data';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;
const PREFETCH_THRESHOLD = 15;

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

/** @public */
export interface UseReviewNavigationReturn {
  currentIndex: number;
  currentItem: ReviewQueueItem | null;
  sortedQueue: ReviewQueueItem[];
  currentSortedIndex: number;
  handleSelectItem: (sortedIndex: number) => void;
  handleSkip: () => void;
  handleBack: () => void;
  advanceToNext: () => void;
  setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  cardRef: React.RefObject<HTMLDivElement | null>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Queue position management, sorting, selection, and focus.
 * Owns currentIndex, sorted views, navigation handlers, and prefetch trigger.
 */
export function useReviewNavigation(
  queue: ReviewQueueItem[],
  isLoading: boolean,
  queueQuery: UseInfiniteQueryResult<
    InfiniteData<ReviewQueuePage, number>,
    Error
  >,
): UseReviewNavigationReturn {
  // -----------------------------------------------------------------------
  // Navigation state
  // -----------------------------------------------------------------------

  const [currentIndex, setCurrentIndex] = useState(0);

  const currentItem = queue[currentIndex] ?? null;

  // Reset index to 0 when queue is cleared (e.g. filter change triggers
  // a new query key, producing an empty queue during refetch).
  // setState in effect is intentional — synchronises navigation with external
  // query state changes. The guard prevents unnecessary calls.
  const prevQueueLengthRef = useRef(queue.length);
  useEffect(() => {
    if (queue.length === 0 && prevQueueLengthRef.current > 0) {
      setCurrentIndex(0); // eslint-disable-line react-hooks/set-state-in-effect
    }
    prevQueueLengthRef.current = queue.length;
  }, [queue.length]);

  // -----------------------------------------------------------------------
  // Sorted queue — uses server-provided order (no client-side re-sorting)
  // -----------------------------------------------------------------------

  const sortedQueue = queue;

  // -----------------------------------------------------------------------
  // Panel selection (map sorted index back to real queue index)
  // -----------------------------------------------------------------------

  const handleSelectItem = useCallback(
    (sortedIndex: number) => {
      const selectedItem = sortedQueue[sortedIndex];
      if (!selectedItem) return;
      const realIndex = queue.findIndex((q) => q.id === selectedItem.id);
      if (realIndex >= 0) setCurrentIndex(realIndex);
    },
    [sortedQueue, queue],
  );

  // Current item's index in sorted queue (for panel highlighting)
  const currentSortedIndex = useMemo(() => {
    if (!currentItem) return -1;
    return sortedQueue.findIndex((q) => q.id === currentItem.id);
  }, [sortedQueue, currentItem]);

  // -----------------------------------------------------------------------
  // Navigation handlers
  // -----------------------------------------------------------------------

  const advanceToNext = useCallback(() => {
    setCurrentIndex((prev) => {
      if (prev < queue.length - 1) return prev + 1;
      return prev;
    });
  }, [queue.length]);

  const handleSkip = useCallback(() => {
    if (!currentItem) return;
    // Guard: don't advance if already at the last item
    if (currentIndex >= queue.length - 1) return;
    advanceToNext();
  }, [currentItem, currentIndex, queue.length, advanceToNext]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  // -----------------------------------------------------------------------
  // Focus management: focus card + scroll to top after navigation
  // -----------------------------------------------------------------------

  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && currentItem) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      requestAnimationFrame(() => {
        cardRef.current?.focus({ preventScroll: true });
      });
    }
  }, [currentIndex, isLoading, currentItem]);

  // -----------------------------------------------------------------------
  // Prefetch next batch when approaching the end
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (
      currentIndex >= PREFETCH_THRESHOLD &&
      currentIndex >= queue.length - (BATCH_SIZE - PREFETCH_THRESHOLD) &&
      queueQuery.hasNextPage &&
      !queueQuery.isFetchingNextPage
    ) {
      queueQuery.fetchNextPage();
    }
  }, [
    currentIndex,
    queue.length,
    queueQuery.hasNextPage,
    queueQuery.isFetchingNextPage,
    queueQuery.fetchNextPage,
    queueQuery,
  ]);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------

  return {
    currentIndex,
    currentItem,
    sortedQueue,
    currentSortedIndex,
    handleSelectItem,
    handleSkip,
    handleBack,
    advanceToNext,
    setCurrentIndex,
    cardRef,
  };
}
