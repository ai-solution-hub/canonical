import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  ReviewQueueItem,
  ReviewStatsResponse,
  ReviewFilters as ReviewFiltersType,
  ReviewProgress,
} from '@/types/review';

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

// ---------------------------------------------------------------------------
// Sub-hook mocks (with hoisted mock variables)
// ---------------------------------------------------------------------------

const mockSessionReturn = vi.hoisted(() => ({
  filters: { status: 'unverified' as const } as ReviewFiltersType,
  serverSort: undefined as string | undefined,
  queueSort: 'default' as const,
  setFilters: vi.fn(),
  setQueueSort: vi.fn(),
  handleFiltersChange: vi.fn(),
  progress: {
    verified: 0,
    flagged: 0,
    skipped: 0,
    total: 0,
    sessionReviewed: 0,
  } as ReviewProgress,
  setProgress: vi.fn(),
  announcement: '',
  setAnnouncement: vi.fn(),
  showFlagInput: false,
  flagDetails: '',
  showQueuePanel: false,
  setShowFlagInput: vi.fn(),
  setFlagDetails: vi.fn(),
  handleTogglePanel: vi.fn(),
  flagInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
}));

const mockDataReturn = vi.hoisted(() => ({
  queue: [] as ReviewQueueItem[],
  isLoading: true,
  hasMore: false,
  stats: null as ReviewStatsResponse | null,
  activeAssignment: null,
  queueQuery: {
    data: undefined,
    isLoading: true,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  } as unknown,
  queryClient: null as unknown, // Assigned in beforeEach after QueryClient is available
  queueFiltersKey: {} as Record<string, unknown>,
}));

const mockNavReturn = vi.hoisted(() => ({
  currentIndex: 0,
  currentItem: null as ReviewQueueItem | null,
  sortedQueue: [] as ReviewQueueItem[],
  currentSortedIndex: -1,
  handleSelectItem: vi.fn(),
  handleSkip: vi.fn(),
  handleBack: vi.fn(),
  advanceToNext: vi.fn(),
  setCurrentIndex: vi.fn(),
  cardRef: { current: null } as React.RefObject<HTMLDivElement | null>,
}));

const mockActionsReturn = vi.hoisted(() => ({
  handleVerify: vi.fn(async () => {}),
  handlePublish: vi.fn(async () => {}),
  handleFlagSubmit: vi.fn(async () => {}),
  isActioning: false,
  lastAnnouncement: '',
}));

vi.mock('@/hooks/review/use-review-session', () => ({
  useReviewSession: vi.fn(() => ({ ...mockSessionReturn })),
}));

vi.mock('@/hooks/review/use-review-queue-data', () => ({
  useReviewQueueData: vi.fn(() => ({ ...mockDataReturn })),
}));

vi.mock('@/hooks/review/use-review-navigation', () => ({
  useReviewNavigation: vi.fn(() => ({ ...mockNavReturn })),
}));

vi.mock('@/hooks/review/use-review-actions', () => ({
  useReviewActions: vi.fn(() => ({ ...mockActionsReturn })),
}));

import { useReviewQueue } from '@/hooks/review/use-review-queue';
import { useReviewQueueData } from '@/hooks/review/use-review-queue-data';
import { useReviewNavigation } from '@/hooks/review/use-review-navigation';
import { useReviewActions } from '@/hooks/review/use-review-actions';

// ---------------------------------------------------------------------------
// Global mocks
// ---------------------------------------------------------------------------

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

/**
 * Creates a QueryClientProvider wrapper for renderHook.
 */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
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

/**
 * Helper to configure mock sub-hooks for a loaded state with items.
 */
function setupLoadedState(
  items: ReviewQueueItem[],
  overrides?: {
    stats?: Partial<ReviewStatsResponse>;
    hasMore?: boolean;
    progress?: Partial<ReviewProgress>;
  },
) {
  const dataOverrides = {
    queue: items,
    isLoading: false,
    hasMore: overrides?.hasMore ?? false,
    stats: overrides?.stats
      ? ({
          total: 100,
          verified: 50,
          flagged: 10,
          unverified: 40,
          by_domain: {},
          by_content_type: {},
          by_source_file: {},
          ...overrides.stats,
        } as ReviewStatsResponse)
      : null,
  };
  Object.assign(mockDataReturn, dataOverrides);

  const navOverrides = {
    currentItem: items[0] ?? null,
    currentIndex: 0,
    sortedQueue: items,
    currentSortedIndex: items.length > 0 ? 0 : -1,
  };
  Object.assign(mockNavReturn, navOverrides);

  if (overrides?.progress) {
    Object.assign(mockSessionReturn.progress, overrides.progress);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReviewQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockReset();
    mockReplace.mockReset();
    mockReplaceState.mockReset();
    currentSearchParams = new URLSearchParams();

    // Reset mock return values to defaults
    Object.assign(mockSessionReturn, {
      filters: { status: 'unverified' as const } as ReviewFiltersType,
      serverSort: undefined,
      queueSort: 'default' as const,
      progress: {
        verified: 0,
        flagged: 0,
        skipped: 0,
        total: 0,
        sessionReviewed: 0,
      },
      announcement: '',
      showFlagInput: false,
      flagDetails: '',
      showQueuePanel: false,
    });
    mockSessionReturn.setFilters = vi.fn();
    mockSessionReturn.setQueueSort = vi.fn();
    mockSessionReturn.handleFiltersChange = vi.fn();
    mockSessionReturn.setProgress = vi.fn();
    mockSessionReturn.setAnnouncement = vi.fn();
    mockSessionReturn.setShowFlagInput = vi.fn();
    mockSessionReturn.setFlagDetails = vi.fn();
    mockSessionReturn.handleTogglePanel = vi.fn();

    Object.assign(mockDataReturn, {
      queue: [],
      isLoading: true,
      hasMore: false,
      stats: null,
      activeAssignment: null,
      queryClient: new QueryClient(),
      queueFiltersKey: {},
    });

    Object.assign(mockNavReturn, {
      currentIndex: 0,
      currentItem: null,
      sortedQueue: [],
      currentSortedIndex: -1,
    });
    mockNavReturn.handleSelectItem = vi.fn();
    mockNavReturn.handleSkip = vi.fn();
    mockNavReturn.handleBack = vi.fn();
    mockNavReturn.advanceToNext = vi.fn();
    mockNavReturn.setCurrentIndex = vi.fn();

    Object.assign(mockActionsReturn, {
      isActioning: false,
      lastAnnouncement: '',
    });
    mockActionsReturn.handleVerify = vi.fn(async () => {});
    mockActionsReturn.handlePublish = vi.fn(async () => {});
    mockActionsReturn.handleFlagSubmit = vi.fn(async () => {});
  });

  // =========================================================================
  // Initial state
  // =========================================================================

  describe('initial state', () => {
    it('returns loading=true and empty queue initially', () => {
      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.queue).toEqual([]);
      expect(result.current.currentIndex).toBe(0);
      expect(result.current.currentItem).toBeNull();
      expect(result.current.isActioning).toBe(false);
      expect(result.current.hasMore).toBe(false);
    });

    it('parses status filter from URL search params', () => {
      currentSearchParams = new URLSearchParams('status=flagged');
      mockSessionReturn.filters = { status: 'flagged' };

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.filters.status).toBe('flagged');
    });

    it('defaults to unverified status when no URL param is present', () => {
      currentSearchParams = new URLSearchParams();

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.filters.status).toBe('unverified');
    });
  });

  // =========================================================================
  // Data fetching
  // =========================================================================

  describe('data fetching', () => {
    it('fetches queue on mount and sets items', () => {
      const items = [
        makeQueueItem({ id: 'q1', title: 'First' }),
        makeQueueItem({ id: 'q2', title: 'Second' }, 1),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.queue).toHaveLength(2);
      expect(result.current.queue[0].id).toBe('q1');
      expect(result.current.queue[1].id).toBe('q2');
      expect(result.current.currentItem).not.toBeNull();
      expect(result.current.currentItem!.id).toBe('q1');
    });

    it('fetches stats on mount', () => {
      const items = [makeQueueItem()];
      setupLoadedState(items, {
        stats: { total: 200, verified: 80, flagged: 15 },
      });

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.stats).not.toBeNull();
      expect(result.current.stats!.total).toBe(200);
      expect(result.current.stats!.verified).toBe(80);
      expect(result.current.stats!.flagged).toBe(15);
    });

    it('sets loading=false after fetch completes', () => {
      const items = [makeQueueItem({ id: 'x1' })];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.queue).toHaveLength(1);
    });

    it('delegates error handling to sub-hooks', () => {
      // Data hook handles errors via TanStack Query's error state
      mockDataReturn.isLoading = false;
      mockDataReturn.queue = [];

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.queue).toEqual([]);
    });
  });

  // =========================================================================
  // Navigation
  // =========================================================================

  describe('navigation', () => {
    it('handleSkip delegates to navigation sub-hook', () => {
      const items = [
        makeQueueItem({ id: 'n1' }),
        makeQueueItem({ id: 'n2' }, 1),
        makeQueueItem({ id: 'n3' }, 2),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleSkip();
      });

      expect(mockNavReturn.handleSkip).toHaveBeenCalled();
    });

    it('handleBack delegates to navigation sub-hook', () => {
      const items = [
        makeQueueItem({ id: 'b1' }),
        makeQueueItem({ id: 'b2' }, 1),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleBack();
      });

      expect(mockNavReturn.handleBack).toHaveBeenCalled();
    });

    it('handleBack does nothing at index 0 (delegated)', () => {
      setupLoadedState([makeQueueItem({ id: 'solo' })]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.currentIndex).toBe(0);

      act(() => {
        result.current.handleBack();
      });

      // The navigation hook handles the boundary check internally
      expect(mockNavReturn.handleBack).toHaveBeenCalled();
    });

    it('handleSelectItem delegates to navigation sub-hook', () => {
      const items = [
        makeQueueItem({ id: 's1', primary_domain: 'Zebra' }),
        makeQueueItem({ id: 's2', primary_domain: 'Alpha' }, 1),
        makeQueueItem({ id: 's3', primary_domain: 'Middle' }, 2),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleSelectItem(2);
      });

      expect(mockNavReturn.handleSelectItem).toHaveBeenCalledWith(2);
    });
  });

  // =========================================================================
  // Actions
  // =========================================================================

  describe('actions', () => {
    it('handleVerify delegates to actions sub-hook', async () => {
      const items = [makeQueueItem({ id: 'v1', title: 'Verify Me' })];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.handleVerify();
      });

      expect(mockActionsReturn.handleVerify).toHaveBeenCalled();
    });

    it('handleVerify passes note argument through', async () => {
      const items = [
        makeQueueItem({ id: 'v2', title: 'Optimistic' }),
        makeQueueItem({ id: 'v3' }, 1),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.handleVerify('Review note');
      });

      expect(mockActionsReturn.handleVerify).toHaveBeenCalledWith(
        'Review note',
      );
    });

    it('handleVerify error handling is delegated to actions sub-hook', async () => {
      const items = [
        makeQueueItem({ id: 'fail1', title: 'Fail Item' }),
        makeQueueItem({ id: 'fail2' }, 1),
      ];
      setupLoadedState(items);

      mockActionsReturn.handleVerify = vi.fn(async () => {
        throw new Error('Verify failed');
      });

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      // The error is handled internally by the actions sub-hook
      await act(async () => {
        try {
          await result.current.handleVerify();
        } catch {
          // Expected — sub-hook handles error internally
        }
      });

      expect(mockActionsReturn.handleVerify).toHaveBeenCalled();
    });

    it('handleFlagSubmit delegates to actions sub-hook with details', async () => {
      const items = [
        makeQueueItem({ id: 'f1', title: 'Flag Me' }),
        makeQueueItem({ id: 'f2' }, 1),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.handleFlagSubmit('Needs reclassification');
      });

      expect(mockActionsReturn.handleFlagSubmit).toHaveBeenCalledWith(
        'Needs reclassification',
      );
    });

    it('handleFlag opens the flag input', () => {
      const items = [makeQueueItem({ id: 'hf1' })];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleFlag();
      });

      expect(mockSessionReturn.setShowFlagInput).toHaveBeenCalledWith(true);
    });

    it('handleFlagSubmit delegates flag progression to actions sub-hook', async () => {
      const items = [
        makeQueueItem({ id: 'fp1' }),
        makeQueueItem({ id: 'fp2' }, 1),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.handleFlagSubmit('Bad data');
      });

      expect(mockActionsReturn.handleFlagSubmit).toHaveBeenCalledWith(
        'Bad data',
      );
    });
  });

  // =========================================================================
  // Sorting
  // =========================================================================

  describe('sorting', () => {
    it('sortedQueue returns queue as-is when sort is default', () => {
      const items = [
        makeQueueItem({ id: 'def1', primary_domain: 'Zebra' }),
        makeQueueItem({ id: 'def2', primary_domain: 'Alpha' }, 1),
      ];
      setupLoadedState(items);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.queueSort).toBe('default');
      expect(result.current.sortedQueue[0].id).toBe('def1');
      expect(result.current.sortedQueue[1].id).toBe('def2');
    });

    it('sortedQueue reflects navigation sub-hook sorting', () => {
      const items = [
        makeQueueItem({ id: 'dom1', primary_domain: 'Zebra' }),
        makeQueueItem({ id: 'dom2', primary_domain: 'Alpha' }, 1),
        makeQueueItem({ id: 'dom3', primary_domain: 'Middle' }, 2),
      ];
      // Simulate sorted order from navigation hook
      const sorted = [items[1], items[2], items[0]];
      setupLoadedState(items);
      mockNavReturn.sortedQueue = sorted;

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.sortedQueue[0].primary_domain).toBe('Alpha');
      expect(result.current.sortedQueue[1].primary_domain).toBe('Middle');
      expect(result.current.sortedQueue[2].primary_domain).toBe('Zebra');
    });

    it('setQueueSort delegates to session sub-hook', () => {
      setupLoadedState([makeQueueItem()]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setQueueSort('confidence');
      });

      expect(mockSessionReturn.setQueueSort).toHaveBeenCalledWith('confidence');
    });
  });

  // =========================================================================
  // Filters and exit
  // =========================================================================

  describe('filters and exit', () => {
    it('handleFiltersChange delegates to session sub-hook', () => {
      setupLoadedState([makeQueueItem()]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleFiltersChange({
          status: 'verified',
          domain: ['Technical'],
        });
      });

      expect(mockSessionReturn.handleFiltersChange).toHaveBeenCalledWith({
        status: 'verified',
        domain: ['Technical'],
      });
    });

    it('handleExit navigates to /browse', () => {
      setupLoadedState([makeQueueItem()]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleExit();
      });

      expect(mockPush).toHaveBeenCalledWith('/browse');
    });

    it('setFilters delegates to session sub-hook', () => {
      setupLoadedState([makeQueueItem()]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.setFilters({
          status: 'flagged',
          domain: ['Commercial'],
        });
      });

      expect(mockSessionReturn.setFilters).toHaveBeenCalledWith({
        status: 'flagged',
        domain: ['Commercial'],
      });
    });
  });

  // =========================================================================
  // Panel toggle
  // =========================================================================

  describe('panel toggle', () => {
    it('handleTogglePanel delegates to session sub-hook', () => {
      setupLoadedState([makeQueueItem()]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleTogglePanel();
      });

      expect(mockSessionReturn.handleTogglePanel).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Computed values
  // =========================================================================

  describe('computed values', () => {
    it('currentSortedIndex comes from navigation sub-hook', () => {
      const items = [
        makeQueueItem({ id: 'ci1', primary_domain: 'Zebra' }),
        makeQueueItem({ id: 'ci2', primary_domain: 'Alpha' }, 1),
      ];
      setupLoadedState(items);
      mockNavReturn.currentSortedIndex = 1;

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.currentSortedIndex).toBe(1);
    });

    it('currentItem is null when queue is empty', () => {
      setupLoadedState([]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.currentItem).toBeNull();
    });
  });

  // =========================================================================
  // Announcements (accessibility)
  // =========================================================================

  describe('announcements', () => {
    it('announcement comes from session sub-hook', () => {
      setupLoadedState([
        makeQueueItem({ id: 'a1' }),
        makeQueueItem({ id: 'a2' }, 1),
      ]);
      mockSessionReturn.announcement = 'Item 2 of 10. Next Item.';

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.announcement).toContain('Item 2');
    });

    it('syncs action announcements into session state', () => {
      setupLoadedState([
        makeQueueItem({ id: 'av1' }),
        makeQueueItem({ id: 'av2' }, 1),
      ]);
      mockActionsReturn.lastAnnouncement =
        'Verified. Item 2 of 100. Verify Announce.';

      renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      // The orchestrator's useEffect should sync lastAnnouncement to session
      expect(mockSessionReturn.setAnnouncement).toHaveBeenCalledWith(
        'Verified. Item 2 of 100. Verify Announce.',
      );
    });
  });

  // =========================================================================
  // Orchestrator wiring (composition tests)
  // =========================================================================

  describe('orchestrator wiring', () => {
    it('passes session filters and serverSort to data hook', () => {
      mockSessionReturn.filters = { status: 'flagged', domain: ['Technical'] };
      mockSessionReturn.serverSort = 'confidence_asc';

      renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(vi.mocked(useReviewQueueData)).toHaveBeenCalledWith(
        { status: 'flagged', domain: ['Technical'] },
        'confidence_asc',
      );
    });

    it('passes data queue and session sort to navigation hook', () => {
      const items = [makeQueueItem({ id: 'wire1' })];
      setupLoadedState(items);
      mockSessionReturn.queueSort = 'domain';

      renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(vi.mocked(useReviewNavigation)).toHaveBeenCalledWith(
        items,
        false,
        'domain',
        expect.anything(),
      );
    });

    it('passes correct params to actions hook', () => {
      const items = [makeQueueItem({ id: 'wire2' })];
      setupLoadedState(items);

      renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(vi.mocked(useReviewActions)).toHaveBeenCalledWith(
        expect.objectContaining({
          queue: items,
          currentIndex: 0,
          currentItem: items[0],
        }),
      );
    });

    it('handleFlag does nothing when isActioning is true', () => {
      setupLoadedState([makeQueueItem({ id: 'guard1' })]);
      mockActionsReturn.isActioning = true;

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleFlag();
      });

      expect(mockSessionReturn.setShowFlagInput).not.toHaveBeenCalled();
    });

    it('handleFlag does nothing when no current item', () => {
      setupLoadedState([]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleFlag();
      });

      expect(mockSessionReturn.setShowFlagInput).not.toHaveBeenCalled();
    });

    it('handleEdit opens item in new tab', () => {
      const items = [makeQueueItem({ id: 'edit1' })];
      setupLoadedState(items);

      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleEdit();
      });

      expect(openSpy).toHaveBeenCalledWith('/item/edit1', '_blank');
      openSpy.mockRestore();
    });

    it('handleEdit does nothing when no current item', () => {
      setupLoadedState([]);

      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.handleEdit();
      });

      expect(openSpy).not.toHaveBeenCalled();
      openSpy.mockRestore();
    });
  });

  // =========================================================================
  // Cross-hook effects
  // =========================================================================

  describe('cross-hook effects', () => {
    it('syncs stats into progress with Math.max guard (S126 #1)', () => {
      setupLoadedState([makeQueueItem()], {
        stats: { total: 100, verified: 50, flagged: 10 },
      });

      renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      // The stats sync useEffect should call setProgress with Math.max guard
      expect(mockSessionReturn.setProgress).toHaveBeenCalled();
      const updateFn = mockSessionReturn.setProgress.mock.calls[0][0];
      // Simulate: optimistic progress has verified=55, stats says 50 -> should keep 55
      const result = updateFn({
        verified: 55,
        flagged: 12,
        total: 100,
        skipped: 0,
        sessionReviewed: 5,
      });
      expect(result.verified).toBe(55); // Math.max(50, 55) = 55
      expect(result.flagged).toBe(12); // Math.max(10, 12) = 12
      expect(result.total).toBe(100);
    });

    it('does not sync stats when stats is null', () => {
      setupLoadedState([makeQueueItem()]);
      mockDataReturn.stats = null;

      renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(mockSessionReturn.setProgress).not.toHaveBeenCalled();
    });

    it('does not sync empty lastAnnouncement', () => {
      setupLoadedState([makeQueueItem()]);
      mockActionsReturn.lastAnnouncement = '';

      renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(mockSessionReturn.setAnnouncement).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // New tests: TanStack Query specific (Section 7.4)
  // =========================================================================

  describe('TanStack Query integration', () => {
    it('hasMore reflects hasNextPage from infinite query', () => {
      setupLoadedState([makeQueueItem()]);
      mockDataReturn.hasMore = true;

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasMore).toBe(true);
    });

    it('has_more: false results in hasMore=false', () => {
      setupLoadedState([makeQueueItem()]);
      mockDataReturn.hasMore = false;

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.hasMore).toBe(false);
    });

    it('isActioning is derived from mutation pending states', () => {
      setupLoadedState([makeQueueItem()]);
      mockActionsReturn.isActioning = true;

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isActioning).toBe(true);
    });

    it('activeAssignment comes from data hook', () => {
      setupLoadedState([makeQueueItem()]);
      mockDataReturn.activeAssignment = {
        id: 'assign-1',
        notes: 'Review these items',
        filter_domains: ['Technical'],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: 20,
        due_date: '2026-04-01',
      };

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      expect(result.current.activeAssignment).not.toBeNull();
      expect(result.current.activeAssignment!.id).toBe('assign-1');
      expect(result.current.activeAssignment!.filter_domains).toEqual([
        'Technical',
      ]);
    });

    it('handlePublish delegates to actions sub-hook', async () => {
      setupLoadedState([
        makeQueueItem({ id: 'pub1', governance_review_status: 'draft' }),
      ]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      await act(async () => {
        await result.current.handlePublish();
      });

      expect(mockActionsReturn.handlePublish).toHaveBeenCalled();
    });

    it('all 36 return properties are present', () => {
      setupLoadedState([makeQueueItem()]);

      const { result } = renderHook(() => useReviewQueue(), {
        wrapper: createWrapper(),
      });

      const expectedProperties = [
        'queue',
        'currentIndex',
        'isLoading',
        'isActioning',
        'hasMore',
        'progress',
        'filters',
        'stats',
        'showFlagInput',
        'flagDetails',
        'showQueuePanel',
        'queueSort',
        'announcement',
        'activeAssignment',
        'cardRef',
        'flagInputRef',
        'currentItem',
        'sortedQueue',
        'currentSortedIndex',
        'handleSelectItem',
        'handleVerify',
        'handlePublish',
        'handleFlagSubmit',
        'handleFlag',
        'handleSkip',
        'handleBack',
        'handleExit',
        'handleEdit',
        'handleFiltersChange',
        'handleTogglePanel',
        'setShowFlagInput',
        'setFlagDetails',
        'setFilters',
        'setQueueSort',
        'showHelp',
        'setShowHelp',
      ];

      for (const prop of expectedProperties) {
        expect(result.current).toHaveProperty(prop);
      }

      expect(expectedProperties).toHaveLength(36);
    });
  });
});
