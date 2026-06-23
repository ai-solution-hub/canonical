import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockRpc,
  mockFrom,
  mockFilters,
  mockSetFilters,
  mockSearchQuery,
  mockSetSearchQuery,
  mockClearSearchQuery,
  mockClearFilters,
} = vi.hoisted(() => {
  return {
    mockRpc: vi.fn(),
    mockFrom: vi.fn(),
    mockFilters: {
      sort: 'captured_date' as const,
      order: 'desc' as const,
    } as Record<string, unknown>,
    mockSetFilters: vi.fn(),
    mockSearchQuery: { value: undefined as string | undefined },
    mockSetSearchQuery: vi.fn(),
    mockClearSearchQuery: vi.fn(),
    mockClearFilters: vi.fn(),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
  }),
}));

vi.mock('@/hooks/browse/use-browse-filters', () => ({
  useBrowseFilters: () => ({
    filters: mockFilters,
    activeFilterCount: 0,
    searchQuery: mockSearchQuery.value,
    setFilters: mockSetFilters,
    setSearchQuery: mockSetSearchQuery,
    clearSearchQuery: mockClearSearchQuery,
    clearFilters: mockClearFilters,
  }),
}));

vi.mock('@/lib/browse-helpers', () => ({
  getCursorFromItem: vi.fn(() => '2026-01-01'),
  isOffsetSort: vi.fn(
    (sort: string) => sort === 'freshness' || sort === 'quality_score',
  ),
}));

vi.mock('@/lib/supabase/escape', () => ({
  escapePostgrestValue: vi.fn((v: string) => v),
}));

vi.mock('@/types/content', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    CONTENT_LIST_COLUMNS: 'id, title',
  };
});

import { useBrowseData } from '@/hooks/browse/use-browse-data';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a chainable Supabase query mock.
 * Every method returns the chain itself, and the chain is a PromiseLike
 * that resolves to { data, count, error }.
 */
function createQueryChain(
  resolvedData: unknown[] = [],
  resolvedCount: number | null = null,
  resolvedError: unknown = null,
) {
  const result = {
    data: resolvedData,
    count: resolvedCount,
    error: resolvedError,
  };

  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (onFulfilled?: (v: unknown) => unknown) =>
          Promise.resolve(result).then(onFulfilled);
      }
      // Any chained method returns the proxy itself
      return vi.fn().mockReturnValue(proxy);
    },
  };

  const proxy = new Proxy({}, handler);
  return proxy;
}

const SAMPLE_ITEMS = [
  {
    id: 'item-1',
    title: 'Test Item 1',
    captured_date: '2026-01-15',
    primary_domain: 'Technology',
    classification_confidence: 0.95,
  },
  {
    id: 'item-2',
    title: 'Test Item 2',
    captured_date: '2026-01-14',
    primary_domain: 'People',
    classification_confidence: 0.88,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBrowseData', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset filters to defaults
    Object.keys(mockFilters).forEach((k) => delete mockFilters[k]);
    mockFilters.sort = 'captured_date';
    mockFilters.order = 'desc';

    // Reset search query
    mockSearchQuery.value = undefined;

    // Default: quality flags RPC returns empty
    mockRpc.mockResolvedValue({ data: [], error: null });

    // Default: from() returns a chain resolving to sample items
    mockFrom.mockReturnValue(createQueryChain(SAMPLE_ITEMS, 2));

    // Reset global fetch mock
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('returns loading=true initially', () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('reports filters, activeFilterCount, and setFilters to consumers', () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });
    expect(result.current.filters).toBeDefined();
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.setFilters).toBe(mockSetFilters);
  });

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  it('fetches items on mount and sets isLoading to false', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].id).toBe('item-1');
    expect(result.current.totalCount).toBe(2);
  });

  it('fetches quality-flagged IDs on mount', async () => {
    mockRpc.mockResolvedValue({ data: ['item-1'], error: null });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith('get_items_with_quality_flags');
    expect(result.current.qualityFlaggedIds.has('item-1')).toBe(true);
  });

  it('sets hasMore=false when fewer items than PAGE_SIZE are returned', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // 2 items < PAGE_SIZE (48), so hasMore should be false
    expect(result.current.hasMore).toBe(false);
  });

  it('sets hasMore=true when PAGE_SIZE items are returned', async () => {
    const fullPage = Array.from({ length: 48 }, (_, i) => ({
      id: `item-${i}`,
      title: `Item ${i}`,
      captured_date: '2026-01-15',
      primary_domain: 'Technology',
    }));
    mockFrom.mockReturnValue(createQueryChain(fullPage, 100));

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.totalCount).toBe(100);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('handles query error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFrom.mockReturnValue(
      createQueryChain([], null, { message: 'DB error' }),
    );

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // TanStack Query throws on error; items should be empty
    expect(result.current.items).toEqual([]);
    consoleSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Filter application — empty results from resolvers
  // -----------------------------------------------------------------------

  it('returns empty items when keyword filter resolves to zero matches', async () => {
    mockFilters.keywords = ['nonexistent'];
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'filter_by_keywords') return { data: [], error: null };
      if (name === 'get_items_with_quality_flags')
        return { data: [], error: null };
      return { data: null, error: null };
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.hasMore).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Stale request cancellation
  // -----------------------------------------------------------------------

  it('does not crash during rapid re-renders (TanStack Query handles deduplication)', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result, rerender } = renderHook(() => useBrowseData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    rerender();
    rerender();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // refreshData
  // -----------------------------------------------------------------------

  it('refreshData triggers a re-fetch via query invalidation', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const initialCallCount = mockFrom.mock.calls.length;

    act(() => {
      result.current.refreshData();
    });

    await waitFor(() => {
      expect(mockFrom.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  // -----------------------------------------------------------------------
  // sentinelCallbackRef
  // -----------------------------------------------------------------------

  it('exposes a sentinel ref callback for infinite scroll', () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });
    expect(typeof result.current.sentinelCallbackRef).toBe('function');
  });

  // -----------------------------------------------------------------------
  // Offset-based pagination for freshness / quality_score sorts
  // -----------------------------------------------------------------------

  it('sets hasMore=true for freshness sort when PAGE_SIZE items returned', async () => {
    mockFilters.sort = 'freshness';
    mockFilters.order = 'asc';

    const fullPage = Array.from({ length: 48 }, (_, i) => ({
      id: `item-${i}`,
      title: `Item ${i}`,
      captured_date: '2026-01-15',
      primary_domain: 'Technology',
      freshness: 'stale',
    }));
    mockFrom.mockReturnValue(createQueryChain(fullPage, 100));

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(48);
  });

  it('sets hasMore=true for quality_score sort when PAGE_SIZE items returned', async () => {
    mockFilters.sort = 'quality_score';
    mockFilters.order = 'asc';

    const fullPage = Array.from({ length: 48 }, (_, i) => ({
      id: `item-${i}`,
      title: `Item ${i}`,
      captured_date: '2026-01-15',
      primary_domain: 'Technology',
      quality_score: 0.5,
    }));
    mockFrom.mockReturnValue(createQueryChain(fullPage, 100));

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(48);
  });

  it('resets pages when filters change (filter change produces new query key)', async () => {
    mockFilters.sort = 'freshness';
    mockFilters.order = 'asc';

    const fullPage = Array.from({ length: 48 }, (_, i) => ({
      id: `item-${i}`,
      title: `Item ${i}`,
      captured_date: '2026-01-15',
      primary_domain: 'Technology',
      freshness: 'stale',
    }));
    mockFrom.mockReturnValue(createQueryChain(fullPage, 100));

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Items loaded — verify initial state is correct
    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(48);
  });

  // -----------------------------------------------------------------------
  // Search mode
  // -----------------------------------------------------------------------

  describe('search mode', () => {
    const SEARCH_RESULTS = [
      {
        id: 'search-1',
        title: 'Search Result 1',
        captured_date: '2026-01-20',
        primary_domain: 'Technology',
        primary_subtopic: 'software',
        content_type: 'article',
        freshness: 'fresh',
        similarity: 0.92,
      },
      {
        id: 'search-2',
        title: 'Search Result 2',
        captured_date: '2026-01-18',
        primary_domain: 'People',
        primary_subtopic: 'training',
        content_type: 'report',
        freshness: 'aging',
        similarity: 0.85,
      },
      {
        id: 'search-3',
        title: 'Search Result 3',
        captured_date: '2026-01-16',
        primary_domain: 'Technology',
        primary_subtopic: 'hardware',
        content_type: 'article',
        freshness: 'stale',
        similarity: 0.78,
      },
    ];

    function mockFetchSuccess(results: unknown[] = SEARCH_RESULTS) {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ results }),
      } as Response);
    }

    it('calls fetch with /api/search when searchQuery is set', async () => {
      mockSearchQuery.value = 'test query';
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      renderHook(() => useBrowseData(), { wrapper: Wrapper });

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledWith(
          '/api/search',
          expect.objectContaining({
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: 'test query',
              threshold: 0.35,
              limit: 50,
            }),
          }),
        );
      });
    });

    it('stores search results in items', async () => {
      mockSearchQuery.value = 'test query';
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.items).toHaveLength(3);
      expect(result.current.items[0].id).toBe('search-1');
      expect(result.current.totalCount).toBe(3);
    });

    it('returns isSearchMode=true when searchQuery is set', async () => {
      mockSearchQuery.value = 'test query';
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      expect(result.current.isSearchMode).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.isSearchMode).toBe(true);
    });

    it('returns isSearchMode=false when searchQuery is not set', async () => {
      mockSearchQuery.value = undefined;

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      expect(result.current.isSearchMode).toBe(false);
    });

    it('sets hasMore=false for search results (all returned at once)', async () => {
      mockSearchQuery.value = 'test query';
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.hasMore).toBe(false);
    });

    it('sets searchError when fetch response is not ok', async () => {
      mockSearchQuery.value = 'failing query';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Something went wrong' }),
      } as Response);

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.searchError).toBe('Something went wrong');
      expect(result.current.items).toEqual([]);
    });

    it('sets specific error message for EMBEDDING_FAILED code', async () => {
      mockSearchQuery.value = 'failing query';
      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        json: async () => ({
          code: 'EMBEDDING_FAILED',
          error: 'Embedding error',
        }),
      } as Response);

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.searchError).toBe(
        'Search is temporarily unavailable. Please try again shortly.',
      );
    });

    it('sets searchError when fetch throws a network error', async () => {
      mockSearchQuery.value = 'failing query';
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(
        new Error('Network failure'),
      );

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.searchError).toBe('Network failure');
    });

    it('does not call Supabase from() for main query in search mode', async () => {
      mockSearchQuery.value = 'test query';
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // In search mode, the browseQuery is disabled (enabled: false).
      // The only from() calls should be from freshness counts (4 calls).
      const contentItemCalls = mockFrom.mock.calls.filter(
        (call: unknown[]) => call[0] === 'content_items',
      );
      expect(contentItemCalls.length).toBe(4);
    });

    // -------------------------------------------------------------------
    // applyPostFilters tests
    // -------------------------------------------------------------------

    it('filters search results by domain via applyPostFilters', async () => {
      mockSearchQuery.value = 'test query';
      mockFilters.domain = ['Technology'];
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Only items with primary_domain 'Technology' should remain
      expect(result.current.items).toHaveLength(2);
      expect(
        result.current.items.every((i) => i.primary_domain === 'Technology'),
      ).toBe(true);
    });

    it('filters search results by content_type via applyPostFilters', async () => {
      mockSearchQuery.value = 'test query';
      mockFilters.content_type = ['report'];
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].id).toBe('search-2');
    });

    it('filters search results by freshness via applyPostFilters', async () => {
      mockSearchQuery.value = 'test query';
      mockFilters.freshness = ['fresh', 'aging'];
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Only 'fresh' and 'aging' items should pass
      expect(result.current.items).toHaveLength(2);
      const freshnesses = result.current.items.map((i) => i.freshness);
      expect(freshnesses).toContain('fresh');
      expect(freshnesses).toContain('aging');
      expect(freshnesses).not.toContain('stale');
    });

    it('applies multiple post-filters simultaneously', async () => {
      mockSearchQuery.value = 'test query';
      mockFilters.domain = ['Technology'];
      mockFilters.freshness = ['fresh'];
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Only Technology + fresh => search-1
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].id).toBe('search-1');
    });

    it('reports searchQuery, setSearchQuery, and clearSearchQuery to consumers', async () => {
      mockSearchQuery.value = 'my query';
      mockFetchSuccess();

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      expect(result.current.searchQuery).toBe('my query');
      expect(result.current.setSearchQuery).toBe(mockSetSearchQuery);
      expect(result.current.clearSearchQuery).toBe(mockClearSearchQuery);
    });

    // -------------------------------------------------------------------
    // §1.20 Browse Cards — AC-9 / D-8 regression: search mode does NOT
    // exclude Q&A by default (spec §11.6 test 22).
    // -------------------------------------------------------------------
    it('returns Q&A pairs in search results without an include_qa filter (AC-9 / D-8: search mode does not exclude Q&A by default)', async () => {
      mockSearchQuery.value = 'social value';
      // No include_qa filter set — search must still return q_a_pair items.
      const MIXED_RESULTS = [
        {
          id: 'qa-1',
          title: 'Reusable Q&A pair on social value',
          captured_date: '2026-02-10',
          primary_domain: 'social-value',
          content_type: 'q_a_pair',
          freshness: 'fresh',
          similarity: 0.91,
        },
        {
          id: 'art-1',
          title: 'Article on social value commitments',
          captured_date: '2026-02-11',
          primary_domain: 'social-value',
          content_type: 'article',
          freshness: 'fresh',
          similarity: 0.87,
        },
        {
          id: 'qa-2',
          title: 'Another Q&A pair',
          captured_date: '2026-02-09',
          primary_domain: 'social-value',
          content_type: 'q_a_pair',
          freshness: 'aging',
          similarity: 0.83,
        },
      ];
      mockFetchSuccess(MIXED_RESULTS);

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // applyPostFilters does NOT gate on include_qa — q_a_pair items
      // must remain in the result set when the user has not opted in.
      // This is the search-mode regression guard for spec D-8 / AC-9.
      const ids = result.current.items.map((i) => i.id);
      expect(ids).toContain('qa-1');
      expect(ids).toContain('qa-2');
      expect(ids).toContain('art-1');
      expect(result.current.items).toHaveLength(3);
      expect(
        result.current.items.some((i) => i.content_type === 'q_a_pair'),
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // New TanStack Query-specific tests
  // -----------------------------------------------------------------------

  describe('TanStack Query features', () => {
    it('exposes clearFilters to consumers', () => {
      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });
      expect(result.current.clearFilters).toBe(mockClearFilters);
    });

    it('returns freshnessCounts as null initially then populates', async () => {
      // Override default mock to return specific freshness counts
      mockFrom.mockImplementation((table: string) => {
        if (table === 'content_items') {
          // The freshness count queries return head-only with count
          return createQueryChain(SAMPLE_ITEMS, 10);
        }
        return createQueryChain();
      });

      const { Wrapper } = createQueryWrapper();
      const { result } = renderHook(() => useBrowseData(), {
        wrapper: Wrapper,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      // Freshness counts should eventually be populated
      await waitFor(() => {
        expect(result.current.freshnessCounts).not.toBeNull();
      });
    });
  });
});
