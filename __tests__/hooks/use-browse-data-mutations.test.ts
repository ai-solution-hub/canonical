/**
 * useBrowseData Mutation Tests
 *
 * Tests the optimistic update functions using TanStack Query's
 * queryClient.setQueryData pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

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
      return vi.fn().mockReturnValue(proxy);
    },
  };

  const proxy = new Proxy({}, handler);
  return proxy;
}

const MOCK_ITEMS = [
  { id: 'item-1', title: 'First', verified_at: null, content_type: 'article' },
  {
    id: 'item-2',
    title: 'Second',
    verified_at: '2026-01-01T00:00:00Z',
    content_type: 'article',
  },
  { id: 'item-3', title: 'Third', verified_at: null, content_type: 'article' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBrowseData mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchQuery.value = undefined;

    // Reset filters
    Object.keys(mockFilters).forEach((k) => delete mockFilters[k]);
    mockFilters.sort = 'captured_date';
    mockFilters.order = 'desc';

    // Set up query chain for initial fetch
    mockFrom.mockReturnValue(createQueryChain(MOCK_ITEMS, 3));
    mockRpc.mockResolvedValue({ data: ['item-2'], error: null });
  });

  it('updateItemLocally updates verified_at on matching item', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items.length).toBe(3);
    expect(result.current.items[0].verified_at).toBeNull();

    act(() => {
      result.current.updateItemLocally('item-1', {
        verified_at: '2026-03-24T00:00:00Z',
      });
    });

    await waitFor(() => {
      expect(result.current.items[0].verified_at).toBe('2026-03-24T00:00:00Z');
    });
  });

  it('updateItemLocally does not affect other items', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateItemLocally('item-1', {
        verified_at: '2026-03-24T00:00:00Z',
      });
    });

    await waitFor(() => {
      expect(result.current.items[0].verified_at).toBe('2026-03-24T00:00:00Z');
    });

    // Other items unchanged
    expect(result.current.items[1].verified_at).toBe('2026-01-01T00:00:00Z');
    expect(result.current.items[2].verified_at).toBeNull();
  });

  it('updateQualityFlag adds ID to qualityFlaggedIds', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateQualityFlag('item-3', true);
    });

    await waitFor(() => {
      expect(result.current.qualityFlaggedIds.has('item-3')).toBe(true);
    });
  });

  it('updateQualityFlag removes ID from qualityFlaggedIds', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBrowseData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The mock RPC returns ['item-2'] as flagged
    await waitFor(() => {
      expect(result.current.qualityFlaggedIds.has('item-2')).toBe(true);
    });

    act(() => {
      result.current.updateQualityFlag('item-2', false);
    });

    await waitFor(() => {
      expect(result.current.qualityFlaggedIds.has('item-2')).toBe(false);
    });
  });
});
