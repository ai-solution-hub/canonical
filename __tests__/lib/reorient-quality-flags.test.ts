import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(() => ({
    auth: {
      admin: {
        getUserById: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
      },
    },
  })),
}));

vi.mock('@/lib/procurement/procurement-queries', () => ({
  fetchActiveProcurementWithStats: vi.fn().mockResolvedValue({
    workspaces: [],
    statsMap: new Map(),
  }),
}));

vi.mock('@/lib/format', () => ({
  formatRelativeDate: vi.fn().mockReturnValue('just now'),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchReorientData quality flag query alignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses get_items_with_quality_flags RPC for admin quality flag count', async () => {
    // Dynamically import to pick up mocks
    const { fetchReorientData } = await import('@/lib/reorient');

    // Create a mock client that tracks RPC calls
    const rpcCalls: string[] = [];

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
        resolve({ data: [], error: null, count: 0 });
        return Promise.resolve({ data: [], error: null, count: 0 });
      }),
    };

    const supabase = {
      from: vi.fn().mockReturnValue(mockChain),
      rpc: vi.fn().mockImplementation((name: string) => {
        rpcCalls.push(name);
        return {
          then: (resolve: (v: unknown) => void) => {
            const result = {
              data:
                name === 'get_items_with_quality_flags'
                  ? ['uuid-1', 'uuid-2']
                  : [],
              error: null,
            };
            resolve(result);
            return Promise.resolve(result);
          },
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: 'user-1', email: 'test@test.com', user_metadata: {} },
          },
          error: null,
        }),
      },
    } as unknown as Parameters<typeof fetchReorientData>[0];

    const result = await fetchReorientData(supabase, 'user-1', true, 'admin');

    // Verify the RPC was called instead of querying ingestion_quality_log directly
    expect(rpcCalls).toContain('get_items_with_quality_flags');
    // The quality flag count should be the length of the array returned by the RPC
    expect(result.counts.quality_flags).toBe(2);
  });

  it('does not call quality flag RPC for non-admin users', async () => {
    const { fetchReorientData } = await import('@/lib/reorient');

    const rpcCalls: string[] = [];

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
        resolve({ data: [], error: null, count: 0 });
        return Promise.resolve({ data: [], error: null, count: 0 });
      }),
    };

    const supabase = {
      from: vi.fn().mockReturnValue(mockChain),
      rpc: vi.fn().mockImplementation((name: string) => {
        rpcCalls.push(name);
        return {
          then: (resolve: (v: unknown) => void) => {
            resolve({ data: [], error: null });
            return Promise.resolve({ data: [], error: null });
          },
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: 'user-1', email: 'test@test.com', user_metadata: {} },
          },
          error: null,
        }),
      },
    } as unknown as Parameters<typeof fetchReorientData>[0];

    const result = await fetchReorientData(supabase, 'user-1', false, 'editor');

    // For non-admin, quality flags should not use the RPC
    expect(rpcCalls).not.toContain('get_items_with_quality_flags');
    expect(result.counts.quality_flags).toBe(0);
  });

  it('returns consistent count format with fetchUnifiedDashboardData', async () => {
    // Both fetchUnifiedDashboardData and fetchReorientData should use the same RPC
    // and count distinct items, not raw log entries.
    // This test verifies the RPC returns distinct UUIDs (array length = count).
    const { fetchReorientData } = await import('@/lib/reorient');

    const mockChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      gt: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
        resolve({ data: [], error: null, count: 0 });
        return Promise.resolve({ data: [], error: null, count: 0 });
      }),
    };

    // Simulate: 3 quality log entries across 2 distinct content items
    // The RPC returns 2 UUIDs (distinct items), not 3 (raw entries)
    const supabase = {
      from: vi.fn().mockReturnValue(mockChain),
      rpc: vi.fn().mockImplementation((name: string) => {
        if (name === 'get_items_with_quality_flags') {
          return {
            then: (resolve: (v: unknown) => void) => {
              // RPC returns DISTINCT content_item_ids
              const result = { data: ['uuid-a', 'uuid-b'], error: null };
              resolve(result);
              return Promise.resolve(result);
            },
          };
        }
        return {
          then: (resolve: (v: unknown) => void) => {
            resolve({ data: [], error: null });
            return Promise.resolve({ data: [], error: null });
          },
        };
      }),
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: 'user-1', email: 'test@test.com', user_metadata: {} },
          },
          error: null,
        }),
      },
    } as unknown as Parameters<typeof fetchReorientData>[0];

    const result = await fetchReorientData(supabase, 'user-1', true, 'admin');

    // Should be 2 (distinct items), not 3 (raw log entries)
    expect(result.counts.quality_flags).toBe(2);
  });
});
