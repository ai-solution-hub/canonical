import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ReviewQueueItem, ReviewStatsResponse } from '@/types/review';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the hook
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => currentSearchParams,
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/hooks/review/use-review-shortcuts', () => ({
  useReviewShortcuts: vi.fn(() => ({
    showHelp: false,
    setShowHelp: vi.fn(),
  })),
}));

import { toast } from 'sonner';
import { useReviewQueue } from '@/hooks/review/use-review-queue';

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockReplaceState = vi.fn();
Object.defineProperty(window, 'history', {
  value: { replaceState: mockReplaceState },
  writable: true,
});

// requestAnimationFrame fires synchronously in tests
global.requestAnimationFrame = vi.fn((cb) => {
  cb(0);
  return 0;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueueItem(overrides: Partial<ReviewQueueItem> = {}, index = 0): ReviewQueueItem {
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
    ...overrides,
  };
}

function mockQueueResponse(
  items: Partial<ReviewQueueItem>[] = [],
  cursor?: string,
) {
  return {
    ok: true,
    json: async () => ({
      items: items.map((item, i) => makeQueueItem(item, i)),
      cursor,
      total: items.length,
      verified_count: 0,
      flagged_count: 0,
    }),
  };
}

function mockStatsResponse(overrides: Partial<ReviewStatsResponse> = {}) {
  return {
    ok: true,
    json: async () => ({
      total: 100,
      verified: 50,
      flagged: 10,
      unverified: 40,
      by_domain: {},
      by_content_type: {},
      by_source_file: {},
      ...overrides,
    }),
  };
}

/**
 * Sets up mockFetch to handle both the queue and stats fetch calls
 * that fire on mount. Returns the items for assertion convenience.
 */
function setupMountFetches(
  queueItems: Partial<ReviewQueueItem>[] = [{}],
  cursor?: string,
  statsOverrides?: Partial<ReviewStatsResponse>,
) {
  mockFetch.mockImplementation((url: string) => {
    if (url.includes('/api/review/queue')) {
      return Promise.resolve(mockQueueResponse(queueItems, cursor));
    }
    if (url.includes('/api/review/stats')) {
      return Promise.resolve(mockStatsResponse(statsOverrides));
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockReplaceState.mockReset();
    currentSearchParams = new URLSearchParams();
  });

  // =========================================================================
  // Initial state
  // =========================================================================

  describe('initial state', () => {
    it('returns loading=true and empty queue initially', () => {
      // Set up fetch so it never resolves (we just want initial state)
      mockFetch.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useReviewQueue());

      expect(result.current.isLoading).toBe(true);
      expect(result.current.queue).toEqual([]);
      expect(result.current.currentIndex).toBe(0);
      expect(result.current.currentItem).toBeNull();
      expect(result.current.isActioning).toBe(false);
      expect(result.current.hasMore).toBe(false);
    });

    it('parses status filter from URL search params', async () => {
      currentSearchParams = new URLSearchParams('status=flagged');
      setupMountFetches();

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.filters.status).toBe('flagged');
      // Verify the queue fetch included the status param
      const queueCall = mockFetch.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('/api/review/queue'),
      );
      expect(queueCall).toBeDefined();
      expect(queueCall![0]).toContain('status=flagged');
    });

    it('defaults to unverified status when no URL param is present', async () => {
      currentSearchParams = new URLSearchParams();
      setupMountFetches();

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.filters.status).toBe('unverified');
    });
  });

  // =========================================================================
  // Data fetching
  // =========================================================================

  describe('data fetching', () => {
    it('fetches queue on mount and sets items', async () => {
      const items = [{ id: 'q1', title: 'First' }, { id: 'q2', title: 'Second' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.queue).toHaveLength(2);
      expect(result.current.queue[0].id).toBe('q1');
      expect(result.current.queue[1].id).toBe('q2');
      expect(result.current.currentItem).not.toBeNull();
      expect(result.current.currentItem!.id).toBe('q1');
    });

    it('fetches stats on mount', async () => {
      setupMountFetches([{}], undefined, { total: 200, verified: 80, flagged: 15 });

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.stats).not.toBeNull();
      });

      expect(result.current.stats!.total).toBe(200);
      expect(result.current.stats!.verified).toBe(80);
      expect(result.current.stats!.flagged).toBe(15);
    });

    it('sets loading=false after fetch completes', async () => {
      setupMountFetches([{ id: 'x1' }]);

      const { result } = renderHook(() => useReviewQueue());

      // Initially loading
      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.queue).toHaveLength(1);
    });

    it('shows error toast on queue fetch failure', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/api/review/queue')) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        if (url.includes('/api/review/stats')) {
          return Promise.resolve(mockStatsResponse());
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      });

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(toast.error).toHaveBeenCalledWith('Failed to load review queue');
    });
  });

  // =========================================================================
  // Navigation
  // =========================================================================

  describe('navigation', () => {
    it('handleSkip advances currentIndex without incrementing counters', async () => {
      const items = [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.handleSkip();
      });

      expect(result.current.currentIndex).toBe(1);
      // Next/Skip is now pure navigation — no counter increments
      expect(result.current.progress.skipped).toBe(0);
      expect(result.current.progress.sessionReviewed).toBe(0);
    });

    it('handleBack decrements currentIndex', async () => {
      const items = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Skip forward first
      act(() => {
        result.current.handleSkip();
      });
      expect(result.current.currentIndex).toBe(1);

      // Now go back
      act(() => {
        result.current.handleBack();
      });
      expect(result.current.currentIndex).toBe(0);
    });

    it('handleBack does nothing at index 0', async () => {
      setupMountFetches([{ id: 'solo' }]);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.handleBack();
      });

      expect(result.current.currentIndex).toBe(0);
    });

    it('handleSelectItem maps from sorted index to real index', async () => {
      const items = [
        { id: 's1', primary_domain: 'Zebra' },
        { id: 's2', primary_domain: 'Alpha' },
        { id: 's3', primary_domain: 'Middle' },
      ];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Sort by domain
      act(() => {
        result.current.setQueueSort('domain');
      });

      // After sorting: Alpha (s2), Middle (s3), Zebra (s1)
      expect(result.current.sortedQueue[0].id).toBe('s2');
      expect(result.current.sortedQueue[1].id).toBe('s3');
      expect(result.current.sortedQueue[2].id).toBe('s1');

      // Select the third item in sorted order (Zebra = s1 = real index 0)
      act(() => {
        result.current.handleSelectItem(2);
      });

      expect(result.current.currentIndex).toBe(0); // s1 is at real index 0
      expect(result.current.currentItem!.id).toBe('s1');
    });
  });

  // =========================================================================
  // Actions
  // =========================================================================

  describe('actions', () => {
    it('handleVerify calls POST /api/review/action with verify action', async () => {
      const items = [{ id: 'v1', title: 'Verify Me' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Reset fetch to track the verify call
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      // Find the POST call to /api/review/action
      const actionCall = mockFetch.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0] === '/api/review/action' &&
          (call[1] as RequestInit)?.method === 'POST',
      );
      expect(actionCall).toBeDefined();

      const body = JSON.parse((actionCall![1] as RequestInit).body as string);
      expect(body.item_id).toBe('v1');
      expect(body.action).toBe('verify');
    });

    it('handleVerify updates progress optimistically', async () => {
      const items = [{ id: 'v2', title: 'Optimistic' }, { id: 'v3' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialVerified = result.current.progress.verified;
      const initialSessionReviewed = result.current.progress.sessionReviewed;

      // Never resolving fetch to check optimistic state
      mockFetch.mockReturnValue(new Promise(() => {}));

      act(() => {
        // Fire and forget — we check optimistic state immediately
        result.current.handleVerify();
      });

      // Optimistic: verified count increased and session reviewed increased
      expect(result.current.progress.verified).toBe(initialVerified + 1);
      expect(result.current.progress.sessionReviewed).toBe(initialSessionReviewed + 1);
      // Should advance to next item
      expect(result.current.currentIndex).toBe(1);
    });

    it('handleVerify shows error toast and rolls back on API failure', async () => {
      const items = [{ id: 'fail1', title: 'Fail Item' }, { id: 'fail2' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialVerified = result.current.progress.verified;

      // Make the action call fail
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(toast.error).toHaveBeenCalledWith(
        'Action failed. Check your connection and try again.',
      );

      // Verified count should roll back
      expect(result.current.progress.verified).toBe(initialVerified);
    });

    it('handleFlagSubmit calls POST with flag action and flag_details', async () => {
      const items = [{ id: 'f1', title: 'Flag Me' }, { id: 'f2' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });

      await act(async () => {
        await result.current.handleFlagSubmit('Needs reclassification');
      });

      const actionCall = mockFetch.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0] === '/api/review/action' &&
          (call[1] as RequestInit)?.method === 'POST',
      );
      expect(actionCall).toBeDefined();

      const body = JSON.parse((actionCall![1] as RequestInit).body as string);
      expect(body.item_id).toBe('f1');
      expect(body.action).toBe('flag');
      expect(body.flag_details).toBe('Needs reclassification');
    });

    it('handleFlag opens the flag input', async () => {
      const items = [{ id: 'hf1' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.showFlagInput).toBe(false);

      act(() => {
        result.current.handleFlag();
      });

      expect(result.current.showFlagInput).toBe(true);
    });

    it('handleFlagSubmit updates progress optimistically and advances', async () => {
      const items = [{ id: 'fp1' }, { id: 'fp2' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const initialFlagged = result.current.progress.flagged;

      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      await act(async () => {
        await result.current.handleFlagSubmit('Bad data');
      });

      expect(result.current.progress.flagged).toBe(initialFlagged + 1);
      expect(result.current.progress.sessionReviewed).toBe(1);
      // Should advance to next
      expect(result.current.currentIndex).toBe(1);
    });
  });

  // =========================================================================
  // Sorting
  // =========================================================================

  describe('sorting', () => {
    it('sortedQueue returns queue as-is when sort is default', async () => {
      const items = [
        { id: 'def1', primary_domain: 'Zebra' },
        { id: 'def2', primary_domain: 'Alpha' },
      ];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.queueSort).toBe('default');
      // Same order as original queue
      expect(result.current.sortedQueue[0].id).toBe('def1');
      expect(result.current.sortedQueue[1].id).toBe('def2');
    });

    it('sortedQueue sorts by domain when sort is domain', async () => {
      const items = [
        { id: 'dom1', primary_domain: 'Zebra' },
        { id: 'dom2', primary_domain: 'Alpha' },
        { id: 'dom3', primary_domain: 'Middle' },
      ];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setQueueSort('domain');
      });

      expect(result.current.sortedQueue[0].primary_domain).toBe('Alpha');
      expect(result.current.sortedQueue[1].primary_domain).toBe('Middle');
      expect(result.current.sortedQueue[2].primary_domain).toBe('Zebra');
    });

    it('sortedQueue sorts by confidence descending', async () => {
      const items = [
        { id: 'c1', classification_confidence: 0.5 },
        { id: 'c2', classification_confidence: 0.95 },
        { id: 'c3', classification_confidence: 0.7 },
      ];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.setQueueSort('confidence');
      });

      // Setting confidence sort triggers a server-side refetch; wait for it to complete
      await waitFor(() => {
        expect(result.current.sortedQueue.length).toBe(3);
      });

      expect(result.current.sortedQueue[0].classification_confidence).toBe(0.95);
      expect(result.current.sortedQueue[1].classification_confidence).toBe(0.7);
      expect(result.current.sortedQueue[2].classification_confidence).toBe(0.5);
    });
  });

  // =========================================================================
  // Filters and exit
  // =========================================================================

  describe('filters and exit', () => {
    it('handleFiltersChange updates filters state', async () => {
      setupMountFetches();

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.handleFiltersChange({
          status: 'verified',
          domain: ['Technical'],
        });
      });

      expect(result.current.filters.status).toBe('verified');
      expect(result.current.filters.domain).toEqual(['Technical']);
    });

    it('handleExit navigates to /browse', async () => {
      setupMountFetches();

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.handleExit();
      });

      expect(mockPush).toHaveBeenCalledWith('/browse');
    });

    it('syncs filters to URL via replaceState', async () => {
      setupMountFetches();

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.handleFiltersChange({
          status: 'flagged',
          domain: ['Commercial'],
        });
      });

      await waitFor(() => {
        expect(mockReplaceState).toHaveBeenCalled();
      });

      // Find the call that includes the flagged status
      const matchingCall = mockReplaceState.mock.calls.find(
        (call: unknown[]) =>
          typeof call[2] === 'string' &&
          call[2].includes('status=flagged') &&
          call[2].includes('domain=Commercial'),
      );
      expect(matchingCall).toBeDefined();
    });
  });

  // =========================================================================
  // Panel toggle
  // =========================================================================

  describe('panel toggle', () => {
    it('handleTogglePanel toggles showQueuePanel', async () => {
      setupMountFetches();

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.showQueuePanel).toBe(false);

      act(() => {
        result.current.handleTogglePanel();
      });

      expect(result.current.showQueuePanel).toBe(true);

      act(() => {
        result.current.handleTogglePanel();
      });

      expect(result.current.showQueuePanel).toBe(false);
    });
  });

  // =========================================================================
  // Computed values
  // =========================================================================

  describe('computed values', () => {
    it('currentSortedIndex tracks current item in sorted queue', async () => {
      const items = [
        { id: 'ci1', primary_domain: 'Zebra' },
        { id: 'ci2', primary_domain: 'Alpha' },
      ];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Default sort: current item is ci1 at sorted index 0
      expect(result.current.currentSortedIndex).toBe(0);

      // Switch to domain sort: Alpha (ci2) comes first, Zebra (ci1) second
      act(() => {
        result.current.setQueueSort('domain');
      });

      // Current item is still ci1, which is now at sorted index 1
      expect(result.current.currentSortedIndex).toBe(1);
    });

    it('currentItem is null when queue is empty', async () => {
      setupMountFetches([]);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.currentItem).toBeNull();
    });
  });

  // =========================================================================
  // Announcements (accessibility)
  // =========================================================================

  describe('announcements', () => {
    it('sets announcement on next for screen readers', async () => {
      const items = [{ id: 'a1', title: 'Announce Item' }, { id: 'a2', title: 'Next Item' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      act(() => {
        result.current.handleSkip();
      });

      // Next announces the item position without "Skipped" prefix
      expect(result.current.announcement).toContain('Item 2');
      expect(result.current.announcement).toContain('Next Item');
    });

    it('sets announcement on verify for screen readers', async () => {
      const items = [{ id: 'av1', title: 'Verify Announce' }, { id: 'av2' }];
      setupMountFetches(items);

      const { result } = renderHook(() => useReviewQueue());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(result.current.announcement).toContain('Verified');
      expect(result.current.announcement).toContain('Verify Announce');
    });
  });
});
