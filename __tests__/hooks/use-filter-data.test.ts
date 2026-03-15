import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: mockRpc,
    from: mockFrom,
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

import { useFilterData } from '@/hooks/use-filter-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_COUNTS = {
  domain: { Technology: 10, People: 5 },
  content_type: { article: 8, report: 7 },
  platform: { web: 12, newsletter: 3 },
};

const MOCK_AUTHORS = [
  { author_name: 'Alice Smith', count: 12 },
  { author_name: 'Bob Jones', count: 5 },
];

const MOCK_TAGS = { 'important': 5, 'review-needed': 3 };

const MOCK_ENTITIES = [
  { canonical_name: 'Acme Corp', mention_count: 8 },
  { canonical_name: 'TechCo', mention_count: 3 },
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
      case 'get_entity_name_counts':
        return { data: MOCK_ENTITIES, error: null };
      default:
        return { data: null, error: null };
    }
  });

  mockFetch = vi.fn(async (url: string) => {
    if (url === '/api/search/suggestions') {
      return { ok: true, json: async () => ({ keywords: ['ai', 'cloud', 'security'] }) };
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
    renderHook(() => useFilterData({ isOpen: false }));

    // Give effects a chance to run
    await new Promise((r) => setTimeout(r, 50));

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Fetches all data categories when panel opens
  // -----------------------------------------------------------------------

  it('fetches filter counts when panel opens', async () => {
    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await waitFor(() => {
      expect(result.current.counts.domain).toEqual({ Technology: 10, People: 5 });
    });

    expect(result.current.counts.content_type).toEqual({ article: 8, report: 7 });
    expect(result.current.counts.platform).toEqual({ web: 12, newsletter: 3 });
  });

  it('fetches authors when panel opens', async () => {
    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await waitFor(() => {
      expect(result.current.allAuthors).toHaveLength(2);
    });

    expect(result.current.allAuthors[0].name).toBe('Alice Smith');
    expect(result.current.allAuthors[0].count).toBe(12);
  });

  it('fetches popular keywords when panel opens', async () => {
    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await waitFor(() => {
      expect(result.current.popularKeywords).toEqual(['ai', 'cloud', 'security']);
    });
  });

  it('fetches workspaces when panel opens', async () => {
    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await waitFor(() => {
      expect(result.current.allWorkspaces).toHaveLength(2);
    });

    expect(result.current.allWorkspaces[0].name).toBe('Bid Alpha');
  });

  it('fetches user tags when panel opens', async () => {
    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await waitFor(() => {
      expect(result.current.allUserTags).toHaveLength(2);
    });

    // Tags should be sorted by count descending
    expect(result.current.allUserTags[0].tag).toBe('important');
    expect(result.current.allUserTags[0].count).toBe(5);
    expect(result.current.allUserTags[1].tag).toBe('review-needed');
  });

  it('fetches entities when panel opens', async () => {
    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await waitFor(() => {
      expect(result.current.allEntities).toHaveLength(2);
    });

    expect(result.current.allEntities[0].name).toBe('Acme Corp');
    expect(result.current.allEntities[0].count).toBe(8);
  });

  // -----------------------------------------------------------------------
  // Count cache TTL
  // -----------------------------------------------------------------------

  it('serves counts from cache when re-opened within 30 seconds', async () => {
    const { result, rerender } = renderHook(
      ({ isOpen }: { isOpen: boolean }) => useFilterData({ isOpen }),
      { initialProps: { isOpen: true } },
    );

    await waitFor(() => {
      expect(result.current.counts.domain).toEqual({ Technology: 10, People: 5 });
    });

    const firstCallCount = mockRpc.mock.calls.filter(
      (c: unknown[]) => c[0] === 'get_filter_counts',
    ).length;

    // Close and reopen — should use cache
    rerender({ isOpen: false });
    rerender({ isOpen: true });

    await waitFor(() => {
      expect(result.current.counts.domain).toEqual({ Technology: 10, People: 5 });
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

    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'get_filter_counts') {
        return { data: null, error: { message: 'RPC failed' } };
      }
      return { data: null, error: null };
    });

    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    // Should still have empty default counts, not crash
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.counts.domain).toEqual({});

    consoleSpy.mockRestore();
  });

  it('handles keywords fetch failure silently', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Network error');
      }),
    );

    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.popularKeywords).toEqual([]);
  });

  it('handles entities RPC error without crashing', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'get_entity_name_counts') {
        return { data: null, error: { message: 'Entity RPC failed' } };
      }
      return { data: null, error: null };
    });

    const { result } = renderHook(() => useFilterData({ isOpen: true }));

    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.allEntities).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Author search state
  // -----------------------------------------------------------------------

  it('exposes authorSearch and setAuthorSearch', () => {
    const { result } = renderHook(() => useFilterData({ isOpen: false }));
    expect(result.current.authorSearch).toBe('');
    expect(typeof result.current.setAuthorSearch).toBe('function');
  });
});
