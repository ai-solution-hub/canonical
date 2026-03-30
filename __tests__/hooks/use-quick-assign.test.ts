import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useQuickAssign } from '@/hooks/use-quick-assign';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
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

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const WS_ACTIVE_1 = {
  id: 'ws-1',
  name: 'Active Bid Alpha',
  description: null,
  color: '#ff0000',
  icon: 'folder',
  type: 'bid',
  status: 'active',
  domain_metadata: { status: 'drafting', deadline: '2026-04-15' },
  created_by: null,
  updated_by: null,
  is_archived: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const WS_ACTIVE_2 = {
  id: 'ws-2',
  name: 'Active Bid Beta',
  description: null,
  color: '#00ff00',
  icon: 'folder',
  type: 'bid',
  status: 'active',
  domain_metadata: { status: 'matching', deadline: null },
  created_by: null,
  updated_by: null,
  is_archived: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const WS_WON = {
  id: 'ws-3',
  name: 'Won Bid',
  description: null,
  color: '#0000ff',
  icon: 'folder',
  type: 'bid',
  status: 'active',
  domain_metadata: { status: 'won' },
  created_by: null,
  updated_by: null,
  is_archived: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const WS_KB_SECTION = {
  id: 'ws-4',
  name: 'KB Section',
  description: null,
  color: '#999999',
  icon: 'folder',
  type: 'kb_section',
  status: 'active',
  domain_metadata: null,
  created_by: null,
  updated_by: null,
  is_archived: false,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useQuickAssign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return active workspaces
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/workspaces') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              WS_ACTIVE_1,
              WS_ACTIVE_2,
              WS_WON,
              WS_KB_SECTION,
            ]),
        });
      }
      if (url === '/api/items/batch-workspaces') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ assignments: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and filters to active bid workspaces only', async () => {
    const { result } = renderHook(() => useQuickAssign(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingWorkspaces).toBe(false);
    });

    // Should filter out won bid and kb_section workspace
    expect(result.current.activeWorkspaces).toHaveLength(2);
    expect(result.current.activeWorkspaces.map((ws) => ws.id)).toEqual([
      'ws-1',
      'ws-2',
    ]);
  });

  it('sorts workspaces by deadline (soonest first, nulls last)', async () => {
    const { result } = renderHook(() => useQuickAssign(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingWorkspaces).toBe(false);
    });

    // ws-1 has deadline 2026-04-15, ws-2 has null deadline
    expect(result.current.activeWorkspaces[0].id).toBe('ws-1');
    expect(result.current.activeWorkspaces[1].id).toBe('ws-2');
  });

  it('loads assignments for a batch of items', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/workspaces') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([WS_ACTIVE_1]),
        });
      }
      if (url === '/api/items/batch-workspaces') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              assignments: {
                'item-1': ['ws-1'],
                'item-3': ['ws-1', 'ws-2'],
              },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });
    });

    const { result } = renderHook(() => useQuickAssign(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingWorkspaces).toBe(false);
    });

    await act(async () => {
      await result.current.loadAssignments([
        'item-1',
        'item-2',
        'item-3',
      ]);
    });

    expect(result.current.itemAssignments.get('item-1')).toEqual(
      new Set(['ws-1']),
    );
    expect(result.current.itemAssignments.get('item-2')).toEqual(
      new Set([]),
    );
    expect(result.current.itemAssignments.get('item-3')).toEqual(
      new Set(['ws-1', 'ws-2']),
    );
  });

  it('performs optimistic update on assignment toggle', async () => {
    mockFetch.mockImplementation(
      (url: string, init?: RequestInit) => {
        if (url === '/api/workspaces') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([WS_ACTIVE_1]),
          });
        }
        if (url === '/api/items/batch-workspaces') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ assignments: {} }),
          });
        }
        // Simulate slow API
        if (
          typeof url === 'string' &&
          url.includes('/workspaces') &&
          init?.method === 'POST'
        ) {
          return new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: true,
                  json: () => Promise.resolve({ success: true }),
                }),
              100,
            ),
          );
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      },
    );

    const { result } = renderHook(() => useQuickAssign(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingWorkspaces).toBe(false);
    });

    // Load initial empty assignments
    await act(async () => {
      await result.current.loadAssignments(['item-1']);
    });

    expect(result.current.itemAssignments.get('item-1')).toEqual(
      new Set(),
    );

    // Toggle assignment — should optimistically update immediately
    act(() => {
      result.current.toggleAssignment(
        'item-1',
        'ws-1',
        'Active Bid Alpha',
      );
    });

    // Optimistic: should appear assigned immediately
    expect(
      result.current.itemAssignments.get('item-1')?.has('ws-1'),
    ).toBe(true);
  });

  it('does not load assignments for empty array', async () => {
    const { result } = renderHook(() => useQuickAssign(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingWorkspaces).toBe(false);
    });

    await act(async () => {
      await result.current.loadAssignments([]);
    });

    // Should not have called the batch endpoint
    const batchCalls = mockFetch.mock.calls.filter(
      ([url]: [string]) => url === '/api/items/batch-workspaces',
    );
    expect(batchCalls).toHaveLength(0);
  });

  it('handles workspace fetch failure gracefully', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/workspaces') {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () =>
            Promise.resolve({ error: 'Internal Server Error' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    const { result } = renderHook(() => useQuickAssign(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingWorkspaces).toBe(false);
    });

    expect(result.current.activeWorkspaces).toEqual([]);
  });

  it('isAssigning returns false when no mutation is pending', async () => {
    const { result } = renderHook(() => useQuickAssign(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoadingWorkspaces).toBe(false);
    });

    expect(result.current.isAssigning('item-1')).toBe(false);
  });
});
