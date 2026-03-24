/**
 * useBrowseData Mutation Tests
 *
 * Tests the optimistic update functions added to useBrowseData:
 * updateItemLocally and updateQualityFlag.
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
    searchQuery: mockSearchQuery.value,
    setFilters: mockSetFilters,
    setSearchQuery: mockSetSearchQuery,
    clearSearchQuery: mockClearSearchQuery,
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

function createQueryChain(
  resolvedData: unknown[] = [],
  resolvedCount: number | null = null,
  resolvedError: unknown = null,
) {
  const chain: Record<string, unknown> = {};
  const methods = [
    'select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order',
    'limit', 'range', 'gte', 'lte', 'gt', 'lt', 'ilike', 'overlaps',
  ];
  for (const method of methods) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = vi.fn((resolve: (value: unknown) => void) =>
    resolve({ data: resolvedData, count: resolvedCount, error: resolvedError }),
  );
  return chain;
}

const MOCK_ITEMS = [
  { id: 'item-1', title: 'First', verified_at: null, content_type: 'article' },
  { id: 'item-2', title: 'Second', verified_at: '2026-01-01T00:00:00Z', content_type: 'article' },
  { id: 'item-3', title: 'Third', verified_at: null, content_type: 'article' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useBrowseData mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchQuery.value = undefined;

    // Set up query chain for initial fetch
    const chain = createQueryChain(MOCK_ITEMS, 3);
    mockFrom.mockReturnValue(chain);
    mockRpc.mockResolvedValue({ data: ['item-2'] });
  });

  it('updateItemLocally updates verified_at on matching item', async () => {
    const { result } = renderHook(() => useBrowseData());

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items.length).toBe(3);
    expect(result.current.items[0].verified_at).toBeNull();

    act(() => {
      result.current.updateItemLocally('item-1', { verified_at: '2026-03-24T00:00:00Z' });
    });

    expect(result.current.items[0].verified_at).toBe('2026-03-24T00:00:00Z');
  });

  it('updateItemLocally does not affect other items', async () => {
    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateItemLocally('item-1', { verified_at: '2026-03-24T00:00:00Z' });
    });

    // Other items unchanged
    expect(result.current.items[1].verified_at).toBe('2026-01-01T00:00:00Z');
    expect(result.current.items[2].verified_at).toBeNull();
  });

  it('updateQualityFlag adds ID to qualityFlaggedIds', async () => {
    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.updateQualityFlag('item-3', true);
    });

    expect(result.current.qualityFlaggedIds.has('item-3')).toBe(true);
  });

  it('updateQualityFlag removes ID from qualityFlaggedIds', async () => {
    const { result } = renderHook(() => useBrowseData());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // The mock RPC returns ['item-2'] as flagged
    expect(result.current.qualityFlaggedIds.has('item-2')).toBe(true);

    act(() => {
      result.current.updateQualityFlag('item-2', false);
    });

    expect(result.current.qualityFlaggedIds.has('item-2')).toBe(false);
  });
});
