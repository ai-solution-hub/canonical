import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from '@tanstack/react-query';
import type { ReviewQueueItem } from '@/types/review';
import type { QueueSortField } from '@/components/review/review-queue-panel';
import type { ReviewQueuePage } from '@/hooks/review/use-review-queue-data';

import { useReviewNavigation } from '@/hooks/review/use-review-navigation';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueueItem(
  overrides: Partial<ReviewQueueItem> = {},
  index = 0,
): ReviewQueueItem {
  return {
    id: overrides.id ?? `item-${index}`,
    title: overrides.title ?? `Item ${index}`,
    suggested_title: null,
    ai_summary: null,
    primary_domain: 'Technical',
    primary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: null,
    classification_confidence: 0.9,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    content: null,
    source_url: null,
    verified_at: null,
    verified_by: null,
    secondary_domain: null,
    secondary_subtopic: null,
    quality_score: null,
    last_reviewed_at: null,
    ...overrides,
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function makeMockQueueQuery(
  overrides: Partial<
    UseInfiniteQueryResult<InfiniteData<ReviewQueuePage, number>, Error>
  > = {},
): UseInfiniteQueryResult<InfiniteData<ReviewQueuePage, number>, Error> {
  return {
    data: undefined,
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isLoadingError: false,
    isRefetchError: false,
    isSuccess: true,
    status: 'success',
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetching: false,
    isStale: false,
    refetch: vi.fn(),
    fetchStatus: 'idle',
    hasNextPage: false,
    hasPreviousPage: false,
    isFetchingNextPage: false,
    isFetchingPreviousPage: false,
    isFetchNextPageError: false,
    isFetchPreviousPageError: false,
    fetchNextPage: vi.fn(),
    fetchPreviousPage: vi.fn(),
    promise: Promise.resolve({} as InfiniteData<ReviewQueuePage, number>),
    ...overrides,
  } as UseInfiniteQueryResult<InfiniteData<ReviewQueuePage, number>, Error>;
}

// requestAnimationFrame fires synchronously in tests
global.requestAnimationFrame = vi.fn((cb) => {
  cb(0);
  return 0;
});

// Stub scrollTo
window.scrollTo = vi.fn();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReviewNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // Index reset when queue empties
  // =========================================================================

  describe('index reset when queue empties', () => {
    it('resets currentIndex to 0 when queue goes from non-empty to empty', () => {
      const items = [makeQueueItem({ id: 'a' }), makeQueueItem({ id: 'b' }, 1)];
      const queueQuery = makeMockQueueQuery();

      const { result, rerender } = renderHook(
        ({ queue }: { queue: ReviewQueueItem[] }) =>
          useReviewNavigation(queue, false, 'default', queueQuery),
        {
          wrapper: createWrapper(),
          initialProps: { queue: items },
        },
      );

      // Navigate to index 1
      act(() => {
        result.current.setCurrentIndex(1);
      });
      expect(result.current.currentIndex).toBe(1);

      // Empty the queue (simulates filter change triggering refetch)
      rerender({ queue: [] });

      expect(result.current.currentIndex).toBe(0);
    });

    it('does not reset currentIndex when queue stays non-empty', () => {
      const items = [makeQueueItem({ id: 'a' }), makeQueueItem({ id: 'b' }, 1)];
      const queueQuery = makeMockQueueQuery();

      const { result, rerender } = renderHook(
        ({ queue }: { queue: ReviewQueueItem[] }) =>
          useReviewNavigation(queue, false, 'default', queueQuery),
        {
          wrapper: createWrapper(),
          initialProps: { queue: items },
        },
      );

      act(() => {
        result.current.setCurrentIndex(1);
      });

      const newItems = [makeQueueItem({ id: 'c' }, 2)];
      rerender({ queue: newItems });

      // Index stays at 1 because queue did not go empty
      expect(result.current.currentIndex).toBe(1);
    });

    it('does not reset when queue starts empty and stays empty', () => {
      const queueQuery = makeMockQueueQuery();

      const { result, rerender } = renderHook(
        ({ queue }: { queue: ReviewQueueItem[] }) =>
          useReviewNavigation(queue, false, 'default', queueQuery),
        {
          wrapper: createWrapper(),
          initialProps: { queue: [] },
        },
      );

      expect(result.current.currentIndex).toBe(0);

      rerender({ queue: [] });

      expect(result.current.currentIndex).toBe(0);
    });
  });

  // =========================================================================
  // Sort modes
  // =========================================================================

  describe('sort modes', () => {
    const items = [
      makeQueueItem({
        id: 'z',
        primary_domain: 'Zebra',
        content_type: 'guide',
        classification_confidence: 0.5,
        quality_score: 90,
        captured_date: '2026-01-01',
        governance_review_status: null,
      }),
      makeQueueItem(
        {
          id: 'a',
          primary_domain: 'Alpha',
          content_type: 'article',
          classification_confidence: 0.9,
          quality_score: 30,
          captured_date: '2026-03-01',
          governance_review_status: 'pending',
        },
        1,
      ),
      makeQueueItem(
        {
          id: 'm',
          primary_domain: 'Middle',
          content_type: 'brief',
          classification_confidence: 0.7,
          quality_score: 60,
          captured_date: '2026-02-01',
          governance_review_status: null,
        },
        2,
      ),
    ];

    function renderWithSort(sort: QueueSortField) {
      const queueQuery = makeMockQueueQuery();
      return renderHook(
        () => useReviewNavigation(items, false, sort, queueQuery),
        { wrapper: createWrapper() },
      );
    }

    it('default sort returns items in original order', () => {
      const { result } = renderWithSort('default');
      expect(result.current.sortedQueue.map((i) => i.id)).toEqual([
        'z',
        'a',
        'm',
      ]);
    });

    it('flagged sort puts pending items first', () => {
      const { result } = renderWithSort('flagged');
      // Item 'a' has governance_review_status='pending', so it goes first
      expect(result.current.sortedQueue[0].id).toBe('a');
    });

    it('domain sort orders alphabetically by primary_domain', () => {
      const { result } = renderWithSort('domain');
      expect(result.current.sortedQueue.map((i) => i.primary_domain)).toEqual([
        'Alpha',
        'Middle',
        'Zebra',
      ]);
    });

    it('content_type sort orders alphabetically by content_type', () => {
      const { result } = renderWithSort('content_type');
      expect(result.current.sortedQueue.map((i) => i.content_type)).toEqual([
        'article',
        'brief',
        'guide',
      ]);
    });

    it('confidence sort orders by classification_confidence descending', () => {
      const { result } = renderWithSort('confidence');
      expect(
        result.current.sortedQueue.map((i) => i.classification_confidence),
      ).toEqual([0.9, 0.7, 0.5]);
    });

    it('quality_score sort orders by quality_score ascending (lowest first)', () => {
      const { result } = renderWithSort('quality_score');
      expect(result.current.sortedQueue.map((i) => i.quality_score)).toEqual([
        30, 60, 90,
      ]);
    });

    it('date sort orders by captured_date descending (newest first)', () => {
      const { result } = renderWithSort('date');
      expect(result.current.sortedQueue.map((i) => i.captured_date)).toEqual([
        '2026-03-01',
        '2026-02-01',
        '2026-01-01',
      ]);
    });
  });

  // =========================================================================
  // handleSelectItem
  // =========================================================================

  describe('handleSelectItem', () => {
    it('maps sorted index to real queue index', () => {
      // Original order: z, a, m
      // Sorted by domain (Alpha, Middle, Zebra): a, m, z
      const items = [
        makeQueueItem({ id: 'z', primary_domain: 'Zebra' }),
        makeQueueItem({ id: 'a', primary_domain: 'Alpha' }, 1),
        makeQueueItem({ id: 'm', primary_domain: 'Middle' }, 2),
      ];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'domain', queueQuery),
        { wrapper: createWrapper() },
      );

      // Sorted: [a(idx1), m(idx2), z(idx0)]
      // Select sorted index 0 -> item 'a' -> real index 1
      act(() => {
        result.current.handleSelectItem(0);
      });
      expect(result.current.currentIndex).toBe(1);

      // Select sorted index 2 -> item 'z' -> real index 0
      act(() => {
        result.current.handleSelectItem(2);
      });
      expect(result.current.currentIndex).toBe(0);
    });

    it('does nothing for out-of-bounds sorted index', () => {
      const items = [makeQueueItem({ id: 'x' })];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.handleSelectItem(99);
      });

      // Should remain at 0
      expect(result.current.currentIndex).toBe(0);
    });
  });

  // =========================================================================
  // handleSkip and handleBack boundary guards
  // =========================================================================

  describe('handleSkip boundary guards', () => {
    it('advances index by 1 when not at the end', () => {
      const items = [
        makeQueueItem({ id: 'a' }),
        makeQueueItem({ id: 'b' }, 1),
        makeQueueItem({ id: 'c' }, 2),
      ];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.handleSkip();
      });

      expect(result.current.currentIndex).toBe(1);
    });

    it('does not advance past the last item', () => {
      const items = [makeQueueItem({ id: 'a' }), makeQueueItem({ id: 'b' }, 1)];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      // Navigate to last item
      act(() => {
        result.current.setCurrentIndex(1);
      });
      expect(result.current.currentIndex).toBe(1);

      // Attempt to skip past the end
      act(() => {
        result.current.handleSkip();
      });

      // Should stay at 1
      expect(result.current.currentIndex).toBe(1);
    });

    it('does nothing when currentItem is null (empty queue)', () => {
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation([], false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.handleSkip();
      });

      expect(result.current.currentIndex).toBe(0);
    });
  });

  describe('handleBack boundary guards', () => {
    it('moves index back by 1 when not at the start', () => {
      const items = [makeQueueItem({ id: 'a' }), makeQueueItem({ id: 'b' }, 1)];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.setCurrentIndex(1);
      });
      expect(result.current.currentIndex).toBe(1);

      act(() => {
        result.current.handleBack();
      });

      expect(result.current.currentIndex).toBe(0);
    });

    it('does not go below 0', () => {
      const items = [makeQueueItem({ id: 'a' })];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.handleBack();
      });

      // Should remain at 0
      expect(result.current.currentIndex).toBe(0);
    });
  });

  // =========================================================================
  // Prefetch trigger
  // =========================================================================

  describe('prefetch trigger', () => {
    it('calls fetchNextPage when approaching the end of a batch', () => {
      // BATCH_SIZE=20, PREFETCH_THRESHOLD=15
      // Trigger: currentIndex >= 15 AND currentIndex >= queue.length - 5
      // With 20 items, we need index >= 15 to trigger
      const items = Array.from({ length: 20 }, (_, i) =>
        makeQueueItem({ id: `item-${i}` }, i),
      );
      const fetchNextPage = vi.fn();
      const queueQuery = makeMockQueueQuery({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
      });

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.setCurrentIndex(15);
      });

      expect(fetchNextPage).toHaveBeenCalled();
    });

    it('does not call fetchNextPage when hasNextPage is false', () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        makeQueueItem({ id: `item-${i}` }, i),
      );
      const fetchNextPage = vi.fn();
      const queueQuery = makeMockQueueQuery({
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage,
      });

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.setCurrentIndex(15);
      });

      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    it('does not call fetchNextPage when already fetching', () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        makeQueueItem({ id: `item-${i}` }, i),
      );
      const fetchNextPage = vi.fn();
      const queueQuery = makeMockQueueQuery({
        hasNextPage: true,
        isFetchingNextPage: true,
        fetchNextPage,
      });

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.setCurrentIndex(15);
      });

      expect(fetchNextPage).not.toHaveBeenCalled();
    });

    it('does not prefetch when index is below threshold', () => {
      const items = Array.from({ length: 20 }, (_, i) =>
        makeQueueItem({ id: `item-${i}` }, i),
      );
      const fetchNextPage = vi.fn();
      const queueQuery = makeMockQueueQuery({
        hasNextPage: true,
        isFetchingNextPage: false,
        fetchNextPage,
      });

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.setCurrentIndex(5);
      });

      expect(fetchNextPage).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // currentSortedIndex
  // =========================================================================

  describe('currentSortedIndex', () => {
    it('reflects current item position in sorted queue', () => {
      const items = [
        makeQueueItem({ id: 'z', primary_domain: 'Zebra' }),
        makeQueueItem({ id: 'a', primary_domain: 'Alpha' }, 1),
      ];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'domain', queueQuery),
        { wrapper: createWrapper() },
      );

      // currentIndex=0 -> item 'z' -> in sorted [a, z] it's at index 1
      expect(result.current.currentSortedIndex).toBe(1);
    });

    it('returns -1 when queue is empty', () => {
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation([], false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      expect(result.current.currentSortedIndex).toBe(-1);
    });
  });

  // =========================================================================
  // advanceToNext
  // =========================================================================

  describe('advanceToNext', () => {
    it('advances to next item', () => {
      const items = [makeQueueItem({ id: 'a' }), makeQueueItem({ id: 'b' }, 1)];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.advanceToNext();
      });

      expect(result.current.currentIndex).toBe(1);
    });

    it('stays at last index when already at the end', () => {
      const items = [makeQueueItem({ id: 'a' })];
      const queueQuery = makeMockQueueQuery();

      const { result } = renderHook(
        () => useReviewNavigation(items, false, 'default', queueQuery),
        { wrapper: createWrapper() },
      );

      act(() => {
        result.current.advanceToNext();
      });

      // Single item, stays at 0
      expect(result.current.currentIndex).toBe(0);
    });
  });
});
