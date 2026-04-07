import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: mockRpc,
  }),
}));

vi.mock('@/lib/validation/jsonb', () => ({
  parseJsonb: vi.fn((_schema: unknown, data: unknown) => data),
  parseJsonbArray: vi.fn((_schema: unknown, data: unknown) =>
    Array.isArray(data) ? data : [],
  ),
  FilterCountsSchema: {},
  AuthorCountSchema: {},
}));

import { useFilterData } from '@/hooks/browse/use-filter-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper(opts: { staleTime?: number; gcTime?: number } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // Default to a fully fresh cache for deterministic data-fetch tests.
        // Cache-hit tests must pass production-like overrides explicitly so
        // they actually exercise cache retention rather than relying on the
        // observer-still-mounted side effect of `gcTime: 0`.
        gcTime: opts.gcTime ?? 0,
        staleTime: opts.staleTime ?? 0,
      },
    },
  });
  return {
    queryClient,
    Wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

const MOCK_COUNTS = {
  domain: { Technology: 10, People: 5 },
  content_type: { article: 8, report: 7 },
  platform: { web: 12, newsletter: 3 },
};

const MOCK_AUTHORS = [
  { author_name: 'Alice Smith', count: 12 },
  { author_name: 'Bob Jones', count: 5 },
];

const MOCK_TAGS = { important: 5, 'review-needed': 3 };

const MOCK_ENTITIES = [
  {
    canonical_name: 'Acme Corp',
    entity_type: 'organisation',
    mention_count: 8,
  },
  { canonical_name: 'TechCo', entity_type: 'technology', mention_count: 3 },
];

let mockFetch: ReturnType<typeof vi.fn>;

function setupDefaultMocks() {
  mockRpc.mockImplementation(async (name: string) => {
    switch (name) {
      case 'get_filter_counts':
        return { data: MOCK_COUNTS, error: null };
      case 'get_unique_authors':
        return { data: MOCK_AUTHORS, error: null };
      case 'get_user_tag_counts':
        return { data: MOCK_TAGS, error: null };
      case 'get_entity_summary':
        return { data: MOCK_ENTITIES, error: null };
      default:
        return { data: null, error: null };
    }
  });

  mockFetch = vi.fn(async (url: string) => {
    if (url === '/api/search/suggestions') {
      return {
        ok: true,
        json: async () => ({ keywords: ['ai', 'cloud', 'security'] }),
      };
    }
    if (url === '/api/workspaces') {
      return {
        ok: true,
        json: async () => [
          { id: 'ws-1', name: 'Bid Alpha', type: 'bid' },
          { id: 'ws-2', name: 'Bid Beta', type: 'bid' },
        ],
      };
    }
    return { ok: false, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', mockFetch);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFilterData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Lazy loading — no fetch when panel is closed
  // -----------------------------------------------------------------------

  it('does not fetch any data when isOpen is false', async () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useFilterData({ isOpen: false }), { wrapper: Wrapper });

    // Give queries a chance to (not) run
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Fetches all data categories when panel opens
  // -----------------------------------------------------------------------

  it('fetches filter counts when panel opens', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.counts.domain).toEqual({
        Technology: 10,
        People: 5,
      });
    });

    expect(result.current.counts.content_type).toEqual({
      article: 8,
      report: 7,
    });
    expect(result.current.counts.platform).toEqual({ web: 12, newsletter: 3 });
  });

  it('fetches authors when panel opens', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.allAuthors).toHaveLength(2);
    });

    expect(result.current.allAuthors[0].name).toBe('Alice Smith');
    expect(result.current.allAuthors[0].count).toBe(12);
  });

  it('fetches popular keywords when panel opens', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.popularKeywords).toEqual([
        'ai',
        'cloud',
        'security',
      ]);
    });
  });

  it('fetches workspaces when panel opens', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.allWorkspaces).toHaveLength(2);
    });

    expect(result.current.allWorkspaces[0].name).toBe('Bid Alpha');
  });

  it('fetches user tags when panel opens', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.allUserTags).toHaveLength(2);
    });

    // Tags should be sorted by count descending
    expect(result.current.allUserTags[0].tag).toBe('important');
    expect(result.current.allUserTags[0].count).toBe(5);
    expect(result.current.allUserTags[1].tag).toBe('review-needed');
  });

  it('fetches entities when panel opens', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.allEntities).toHaveLength(2);
    });

    expect(result.current.allEntities[0].name).toBe('Acme Corp');
    expect(result.current.allEntities[0].count).toBe(8);
  });

  // -----------------------------------------------------------------------
  // Entity type counts (derived)
  // -----------------------------------------------------------------------

  it('derives entity type counts from entity data', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.entityTypeCounts).toHaveLength(2);
    });

    // Sorted by count descending: organisation (8) > technology (3)
    expect(result.current.entityTypeCounts[0]).toEqual({
      type: 'organisation',
      count: 8,
    });
    expect(result.current.entityTypeCounts[1]).toEqual({
      type: 'technology',
      count: 3,
    });
  });

  // -----------------------------------------------------------------------
  // Cache behaviour — staleTime controls refetch
  // -----------------------------------------------------------------------

  it('serves counts from cache when re-opened within staleTime', async () => {
    // Cache-hit assertion — must use production-like cache options so the
    // test actually exercises `staleTime` rather than relying on the observer
    // staying mounted across a `rerender` (which would mask any real
    // regression in queryKey stability or `enabled` toggling). The production
    // hook ships `staleTime: 30_000` for filter counts; mirror that here so
    // the assertion `secondCallCount === firstCallCount` is meaningful.
    const { Wrapper } = createWrapper({
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    });
    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useFilterData({ isOpen }),
      { initialProps: { isOpen: true }, wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.counts.domain).toEqual({
        Technology: 10,
        People: 5,
      });
    });

    const firstCallCount = mockRpc.mock.calls.filter(
      (c: unknown[]) => c[0] === 'get_filter_counts',
    ).length;

    // Close and reopen — TanStack should serve from cache (staleTime: 30s)
    rerender({ isOpen: false });
    rerender({ isOpen: true });

    await waitFor(() => {
      expect(result.current.counts.domain).toEqual({
        Technology: 10,
        People: 5,
      });
    });

    const secondCallCount = mockRpc.mock.calls.filter(
      (c: unknown[]) => c[0] === 'get_filter_counts',
    ).length;

    // Should not have made another RPC call for counts
    expect(secondCallCount).toBe(firstCallCount);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('handles filter counts RPC error gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { Wrapper } = createWrapper();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'get_filter_counts') {
        return { data: null, error: { message: 'RPC failed' } };
      }
      return { data: null, error: null };
    });

    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    // The queryFn returns EMPTY_COUNTS on error, so counts should be empty
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch filter counts:',
        'RPC failed',
      );
    });

    expect(result.current.counts.domain).toEqual({});

    consoleSpy.mockRestore();
  });

  it('handles keywords fetch failure gracefully', async () => {
    const { Wrapper } = createWrapper();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/search/suggestions') {
          return { ok: false, json: async () => ({ error: 'Not found' }) };
        }
        if (url === '/api/workspaces') {
          return {
            ok: true,
            json: async () => [{ id: 'ws-1', name: 'Bid Alpha', type: 'bid' }],
          };
        }
        return { ok: false, json: async () => ({}) };
      }),
    );

    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    // Keywords should fall back to empty array (fetchJson throws on non-OK,
    // TanStack retries are disabled, so data stays undefined -> defaults to [])
    await waitFor(() => {
      expect(result.current.allWorkspaces).toHaveLength(1);
    });

    expect(result.current.popularKeywords).toEqual([]);
  });

  it('handles entities RPC error without crashing', async () => {
    const { Wrapper } = createWrapper();

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'get_entity_summary') {
        return { data: null, error: { message: 'Entity RPC failed' } };
      }
      if (name === 'get_filter_counts') {
        return { data: MOCK_COUNTS, error: null };
      }
      return { data: null, error: null };
    });

    const { result } = renderHook(() => useFilterData({ isOpen: true }), {
      wrapper: Wrapper,
    });

    // Wait for counts to load (proves queries ran)
    await waitFor(() => {
      expect(result.current.counts.domain).toEqual({
        Technology: 10,
        People: 5,
      });
    });

    // Entities should be empty due to error (queryFn returns [])
    expect(result.current.allEntities).toEqual([]);
    expect(result.current.entityTypeCounts).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Author search state
  // -----------------------------------------------------------------------

  it('exposes authorSearch and setAuthorSearch', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: false }), {
      wrapper: Wrapper,
    });
    expect(result.current.authorSearch).toBe('');
    expect(typeof result.current.setAuthorSearch).toBe('function');
  });

  it('updates authorSearch via setAuthorSearch', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: false }), {
      wrapper: Wrapper,
    });

    act(() => {
      result.current.setAuthorSearch('alice');
    });

    expect(result.current.authorSearch).toBe('alice');
  });

  // -----------------------------------------------------------------------
  // Default values before data loads
  // -----------------------------------------------------------------------

  it('returns empty defaults before queries resolve', () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useFilterData({ isOpen: false }), {
      wrapper: Wrapper,
    });

    expect(result.current.counts).toEqual({
      domain: {},
      content_type: {},
      platform: {},
    });
    expect(result.current.allAuthors).toEqual([]);
    expect(result.current.popularKeywords).toEqual([]);
    expect(result.current.allWorkspaces).toEqual([]);
    expect(result.current.allUserTags).toEqual([]);
    expect(result.current.allEntities).toEqual([]);
    expect(result.current.entityTypeCounts).toEqual([]);
  });
});
