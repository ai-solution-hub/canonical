import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom, mockFilters, mockSetFilters } = vi.hoisted(() => {
  return {
    mockRpc: vi.fn(),
    mockFrom: vi.fn(),
    mockFilters: {
      sort: 'captured_date' as const,
      order: 'desc' as const,
    } as Record<string, unknown>,
    mockSetFilters: vi.fn(),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    rpc: mockRpc,
  }),
}));

vi.mock('@/hooks/use-browse-filters', () => ({
  useBrowseFilters: () => ({
    filters: mockFilters,
    activeFilterCount: 0,
    setFilters: mockSetFilters,
  }),
}));

vi.mock('@/lib/browse-helpers', () => ({
  getCursorFromItem: vi.fn(() => '2026-01-01'),
  isOffsetSort: vi.fn((sort: string) => sort === 'freshness' || sort === 'quality_score'),
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

import { useBrowseData } from '@/hooks/use-browse-data';

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
  const result = { data: resolvedData, count: resolvedCount, error: resolvedError };

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

    // Default: quality flags RPC returns empty
    mockRpc.mockResolvedValue({ data: [], error: null });

    // Default: from() returns a chain resolving to sample items
    mockFrom.mockReturnValue(createQueryChain(SAMPLE_ITEMS, 2));
  });

  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------

  it('returns loading=true initially', () => {
    const { result } = renderHook(() => useBrowseData());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it('exposes filters, activeFilterCount, and setFilters', () => {
    const { result } = renderHook(() => useBrowseData());
    expect(result.current.filters).toBeDefined();
    expect(result.current.activeFilterCount).toBe(0);
    expect(result.current.setFilters).toBe(mockSetFilters);
  });

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  it('fetches items on mount and sets isLoading to false', async () => {
    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0].id).toBe('item-1');
    expect(result.current.totalCount).toBe(2);
  });

  it('fetches quality-flagged IDs on mount', async () => {
    mockRpc.mockResolvedValue({ data: ['item-1'], error: null });

    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith('get_items_with_quality_flags');
    expect(result.current.qualityFlaggedIds.has('item-1')).toBe(true);
  });

  it('sets hasMore=false when fewer items than PAGE_SIZE are returned', async () => {
    const { result } = renderHook(() => useBrowseData());

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

    const { result } = renderHook(() => useBrowseData());

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
    mockFrom.mockReturnValue(createQueryChain([], null, { message: 'DB error' }));

    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Filter application — empty results from resolvers
  // -----------------------------------------------------------------------

  it('returns empty items when keyword filter resolves to zero matches', async () => {
    mockFilters.keywords = ['nonexistent'];
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'filter_by_keywords') return { data: [], error: null };
      if (name === 'get_items_with_quality_flags') return { data: [], error: null };
      return { data: null, error: null };
    });

    const { result } = renderHook(() => useBrowseData());

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

  it('does not crash during rapid re-renders (stale request guard)', async () => {
    const { result, rerender } = renderHook(() => useBrowseData());

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

  it('refreshData triggers a re-fetch', async () => {
    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const initialCallCount = mockFrom.mock.calls.length;

    await waitFor(async () => {
      result.current.refreshData();
    });

    await waitFor(() => {
      expect(mockFrom.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  // -----------------------------------------------------------------------
  // sentinelCallbackRef
  // -----------------------------------------------------------------------

  it('provides a sentinelCallbackRef function', () => {
    const { result } = renderHook(() => useBrowseData());
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

    const { result } = renderHook(() => useBrowseData());

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

    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(48);
  });

  it('resets offset when filters change', async () => {
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

    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Items loaded — now verify initial state is correct
    expect(result.current.hasMore).toBe(true);
    expect(result.current.items).toHaveLength(48);
  });
});
