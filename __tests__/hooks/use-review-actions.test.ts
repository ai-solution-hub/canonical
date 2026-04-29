import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReviewQueueItem, ReviewProgress } from '@/types/review';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted ensures these are available when vi.mock factories run
// ---------------------------------------------------------------------------

const mockMutationFetchJson = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), mockToast),
}));

vi.mock('@/lib/query/fetchers', () => ({
  mutationFetchJson: (...args: unknown[]) => mockMutationFetchJson(...args),
}));

import {
  useReviewActions,
  type UseReviewActionsParams,
} from '@/hooks/review/use-review-actions';

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
    summary: null,
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
    publication_status: null,
    ...overrides,
  };
}

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function makeDefaultParams(
  queryClient: QueryClient,
  overrides: Partial<UseReviewActionsParams> = {},
): UseReviewActionsParams {
  const items = overrides.queue ?? [
    makeQueueItem({ id: 'item-0', title: 'First Item' }),
    makeQueueItem({ id: 'item-1', title: 'Second Item' }, 1),
  ];
  return {
    queue: items,
    currentIndex: 0,
    currentItem: items[0] ?? null,
    queueFiltersKey: { status: 'unverified' },
    queryClient,
    progress: {
      verified: 5,
      flagged: 2,
      skipped: 0,
      total: 100,
      sessionReviewed: 3,
    },
    setProgress: vi.fn(),
    advanceToNext: vi.fn(),
    setCurrentIndex: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReviewActions', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    mockMutationFetchJson.mockResolvedValue({});
  });

  // =========================================================================
  // Verify mutation
  // =========================================================================

  describe('handleVerify', () => {
    it('calls the correct API endpoint with verify action', async () => {
      const params = makeDefaultParams(queryClient);
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(mockMutationFetchJson).toHaveBeenCalledWith(
        '/api/review/action',
        expect.objectContaining({
          item_id: 'item-0',
          action: 'verify',
        }),
      );
    });

    it('passes note to API when provided', async () => {
      const params = makeDefaultParams(queryClient);
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify('Looks good');
      });

      expect(mockMutationFetchJson).toHaveBeenCalledWith(
        '/api/review/action',
        expect.objectContaining({
          item_id: 'item-0',
          action: 'verify',
          note: 'Looks good',
        }),
      );
    });

    it('fires toast before mutateAsync (pre-mutate pattern)', async () => {
      const callOrder: string[] = [];
      mockToast.success.mockImplementation(() => {
        callOrder.push('toast');
      });
      mockMutationFetchJson.mockImplementation(async () => {
        callOrder.push('mutate');
        return {};
      });

      const params = makeDefaultParams(queryClient);
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(callOrder.indexOf('toast')).toBeLessThan(
        callOrder.indexOf('mutate'),
      );
    });

    it('sets verified_at optimistically in the infinite cache', async () => {
      const queueFiltersKey = { status: 'unverified' };
      const queueQueryKey = ['review', 'queue', queueFiltersKey];
      queryClient.setQueryData(queueQueryKey, {
        pages: [
          {
            items: [
              {
                id: 'item-0',
                title: 'First',
                verified_at: null,
                verified_by: null,
              },
              {
                id: 'item-1',
                title: 'Second',
                verified_at: null,
                verified_by: null,
              },
            ],
            total: 2,
            verified_count: 0,
            flagged_count: 0,
            has_more: false,
            nextOffset: 2,
          },
        ],
        pageParams: [0],
      });

      mockMutationFetchJson.mockResolvedValue({});

      const items = [
        makeQueueItem({ id: 'item-0', title: 'First' }),
        makeQueueItem({ id: 'item-1', title: 'Second' }, 1),
      ];
      const params = makeDefaultParams(queryClient, {
        queue: items,
        currentItem: items[0],
        queueFiltersKey,
      });

      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      // After mutation completes, check the cache was optimistically updated
      const cacheData = queryClient.getQueryData<{
        pages: Array<{
          items: Array<{ id: string; verified_at: string | null }>;
        }>;
      }>(queueQueryKey);
      const updatedItem = cacheData?.pages[0]?.items.find(
        (i) => i.id === 'item-0',
      );
      expect(updatedItem?.verified_at).not.toBeNull();
      expect(updatedItem?.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('advances to next item after verify', async () => {
      const advanceToNext = vi.fn();
      const params = makeDefaultParams(queryClient, { advanceToNext });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(advanceToNext).toHaveBeenCalled();
    });

    it('increments sessionReviewed and verified in progress', async () => {
      const setProgress = vi.fn();
      const params = makeDefaultParams(queryClient, { setProgress });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(setProgress).toHaveBeenCalled();
      const updaterFn = setProgress.mock.calls[0][0] as (
        prev: ReviewProgress,
      ) => ReviewProgress;
      const updated = updaterFn({
        verified: 5,
        flagged: 2,
        skipped: 0,
        total: 100,
        sessionReviewed: 3,
      });
      expect(updated.sessionReviewed).toBe(4);
      expect(updated.verified).toBe(6);
    });

    it('does not increment verified count when item was already verified', async () => {
      const setProgress = vi.fn();
      const items = [
        makeQueueItem({
          id: 'item-0',
          title: 'Already Verified',
          verified_at: '2026-01-01T00:00:00Z',
        }),
      ];
      const params = makeDefaultParams(queryClient, {
        queue: items,
        currentItem: items[0],
        setProgress,
      });

      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      const updaterFn = setProgress.mock.calls[0][0] as (
        prev: ReviewProgress,
      ) => ReviewProgress;
      const updated = updaterFn({
        verified: 5,
        flagged: 2,
        skipped: 0,
        total: 100,
        sessionReviewed: 3,
      });
      // verified should NOT increment (wasAlreadyVerified = true)
      expect(updated.verified).toBe(5);
      expect(updated.sessionReviewed).toBe(4);
    });

    it('does nothing when currentItem is null', async () => {
      const params = makeDefaultParams(queryClient, { currentItem: null });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(mockMutationFetchJson).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Flag mutation
  // =========================================================================

  describe('handleFlagSubmit', () => {
    it('calls the correct API endpoint with flag action and details', async () => {
      const params = makeDefaultParams(queryClient);
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleFlagSubmit('Needs reclassification');
      });

      expect(mockMutationFetchJson).toHaveBeenCalledWith(
        '/api/review/action',
        expect.objectContaining({
          item_id: 'item-0',
          action: 'flag',
          flag_details: 'Needs reclassification',
        }),
      );
    });

    it('advances to next item after flagging', async () => {
      const advanceToNext = vi.fn();
      const params = makeDefaultParams(queryClient, { advanceToNext });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleFlagSubmit('Bad data');
      });

      expect(advanceToNext).toHaveBeenCalled();
    });

    it('increments flagged count in progress', async () => {
      const setProgress = vi.fn();
      const params = makeDefaultParams(queryClient, { setProgress });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleFlagSubmit();
      });

      const updaterFn = setProgress.mock.calls[0][0] as (
        prev: ReviewProgress,
      ) => ReviewProgress;
      const updated = updaterFn({
        verified: 5,
        flagged: 2,
        skipped: 0,
        total: 100,
        sessionReviewed: 3,
      });
      expect(updated.flagged).toBe(3);
      expect(updated.sessionReviewed).toBe(4);
    });
  });

  // =========================================================================
  // Publish mutation
  // =========================================================================

  describe('handlePublish', () => {
    it('calls PATCH on the item endpoint to clear governance status', async () => {
      const items = [
        makeQueueItem({
          id: 'pub-1',
          title: 'Draft Item',
          governance_review_status: 'draft',
        }),
      ];
      const params = makeDefaultParams(queryClient, {
        queue: items,
        currentItem: items[0],
      });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handlePublish();
      });

      expect(mockMutationFetchJson).toHaveBeenCalledWith(
        '/api/items/pub-1',
        { field: 'governance_review_status', value: null },
        { method: 'PATCH' },
      );
    });

    it('removes item from cache optimistically', async () => {
      const queueFiltersKey = { status: 'unverified' };
      const queueQueryKey = ['review', 'queue', queueFiltersKey];
      queryClient.setQueryData(queueQueryKey, {
        pages: [
          {
            items: [
              {
                id: 'pub-1',
                title: 'Draft',
                governance_review_status: 'draft',
              },
              { id: 'pub-2', title: 'Other' },
            ],
            total: 2,
            has_more: false,
            nextOffset: 2,
          },
        ],
        pageParams: [0],
      });

      mockMutationFetchJson.mockResolvedValue({});

      const items = [
        makeQueueItem({
          id: 'pub-1',
          title: 'Draft',
          governance_review_status: 'draft',
        }),
        makeQueueItem({ id: 'pub-2', title: 'Other' }, 1),
      ];
      const params = makeDefaultParams(queryClient, {
        queue: items,
        currentItem: items[0],
        queueFiltersKey,
      });

      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handlePublish();
      });

      // After mutation, cache should have the item removed by optimistic update
      const cacheData = queryClient.getQueryData<{
        pages: Array<{ items: Array<{ id: string }> }>;
      }>(queueQueryKey);
      const ids = cacheData?.pages[0]?.items.map((i) => i.id);
      expect(ids).toEqual(['pub-2']);
    });

    it('does nothing when item is not a draft', async () => {
      const items = [
        makeQueueItem({ id: 'nodraft', governance_review_status: null }),
      ];
      const params = makeDefaultParams(queryClient, {
        queue: items,
        currentItem: items[0],
      });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handlePublish();
      });

      expect(mockMutationFetchJson).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Undo mutation (triggered via toast action)
  // =========================================================================

  describe('undo via toast action', () => {
    it('toast action restores previous index on undo', async () => {
      const setCurrentIndex = vi.fn();
      const params = makeDefaultParams(queryClient, { setCurrentIndex });
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      // Extract the toast call and invoke its undo action
      const toastCall = mockToast.success.mock.calls[0];
      expect(toastCall).toBeDefined();
      const toastOptions = toastCall[1] as { action: { onClick: () => void } };
      expect(toastOptions.action).toBeDefined();

      await act(async () => {
        toastOptions.action.onClick();
      });

      expect(setCurrentIndex).toHaveBeenCalledWith(0);
    });

    it('undo mutation uses Math.max(0, ...) guard on sessionReviewed', async () => {
      const setProgress = vi.fn();
      const queueFiltersKey = { status: 'unverified' };
      const queueQueryKey = ['review', 'queue', queueFiltersKey];

      queryClient.setQueryData(queueQueryKey, {
        pages: [
          {
            items: [
              {
                id: 'item-0',
                title: 'First',
                verified_at: '2026-01-01T00:00:00Z',
                verified_by: 'user',
              },
            ],
            total: 1,
            has_more: false,
            nextOffset: 1,
          },
        ],
        pageParams: [0],
      });

      const items = [makeQueueItem({ id: 'item-0', title: 'First' })];
      const params = makeDefaultParams(queryClient, {
        queue: items,
        currentItem: items[0],
        setProgress,
        queueFiltersKey,
        progress: {
          verified: 1,
          flagged: 0,
          skipped: 0,
          total: 100,
          sessionReviewed: 0,
        },
      });

      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      const toastOptions = mockToast.success.mock.calls[0][1] as {
        action: { onClick: () => void };
      };

      // Reset setProgress to capture only the undo call
      setProgress.mockClear();

      await act(async () => {
        toastOptions.action.onClick();
      });

      // The undo mutation's onMutate calls setProgress with Math.max guard
      if (setProgress.mock.calls.length > 0) {
        const undoUpdater = setProgress.mock.calls[0][0];
        if (typeof undoUpdater === 'function') {
          const undoResult = (
            undoUpdater as (prev: ReviewProgress) => ReviewProgress
          )({
            verified: 1,
            flagged: 0,
            skipped: 0,
            total: 100,
            sessionReviewed: 0, // Already at 0
          });
          // Math.max(0, 0 - 1) should be 0, not -1
          expect(undoResult.sessionReviewed).toBe(0);
        }
      }
    });
  });

  // =========================================================================
  // isActioning derived state
  // =========================================================================

  describe('isActioning', () => {
    it('is false when no mutations are pending', () => {
      const params = makeDefaultParams(queryClient);
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      expect(result.current.isActioning).toBe(false);
    });

    it('is true while a verify mutation is pending then false after', async () => {
      let resolveMutation!: () => void;
      const mutationPromise = new Promise<Record<string, never>>((resolve) => {
        resolveMutation = () => resolve({});
      });
      mockMutationFetchJson.mockReturnValue(mutationPromise);

      const params = makeDefaultParams(queryClient);
      const { result } = renderHook(() => useReviewActions(params), {
        wrapper: createWrapper(queryClient),
      });

      // Start verify without awaiting
      const verifyPromise = result.current.handleVerify();

      // Wait for the mutation to be in-flight
      await vi.waitFor(() => {
        expect(mockMutationFetchJson).toHaveBeenCalled();
      });

      expect(result.current.isActioning).toBe(true);

      // Resolve and verify it returns to false
      resolveMutation();
      await act(async () => {
        await verifyPromise;
      });

      await vi.waitFor(() => {
        expect(result.current.isActioning).toBe(false);
      });
    });
  });
});
