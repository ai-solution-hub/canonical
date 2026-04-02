import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockCheckOrphanedSourceIds } = vi.hoisted(() => ({
  mockCheckOrphanedSourceIds: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: vi.fn() }),
}));

vi.mock('@/lib/citations', () => ({
  checkOrphanedSourceIds: (...args: unknown[]) =>
    mockCheckOrphanedSourceIds(...args),
}));

import { useCitationOrphans } from '@/hooks/use-citation-orphans';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
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
// Tests
// ---------------------------------------------------------------------------

describe('useCitationOrphans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set<string>());
  });

  // -----------------------------------------------------------------------
  // Empty input
  // -----------------------------------------------------------------------

  it('returns empty set for empty input array', () => {
    const { result } = renderHook(() => useCitationOrphans([]), {
      wrapper: createWrapper(),
    });
    expect(result.current.size).toBe(0);
    expect(mockCheckOrphanedSourceIds).not.toHaveBeenCalled();
  });

  it('returns empty set when all source IDs are empty strings', () => {
    const { result } = renderHook(() => useCitationOrphans(['', '', '']), {
      wrapper: createWrapper(),
    });
    expect(result.current.size).toBe(0);
    expect(mockCheckOrphanedSourceIds).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Orphan detection
  // -----------------------------------------------------------------------

  it('detects orphaned citations', async () => {
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set(['source-2']));

    const { result } = renderHook(
      () => useCitationOrphans(['source-1', 'source-2', 'source-3']),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    expect(result.current.has('source-2')).toBe(true);
    expect(result.current.has('source-1')).toBe(false);
  });

  it('returns empty set when no citations are orphaned', async () => {
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set());

    const { result } = renderHook(
      () => useCitationOrphans(['source-1', 'source-2']),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(mockCheckOrphanedSourceIds).toHaveBeenCalled();
    });

    expect(result.current.size).toBe(0);
  });

  it('passes deduplicated IDs to checkOrphanedSourceIds', async () => {
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set());

    renderHook(() => useCitationOrphans(['source-1', 'source-1', 'source-2']), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockCheckOrphanedSourceIds).toHaveBeenCalled();
    });

    const passedIds = mockCheckOrphanedSourceIds.mock.calls[0][0];
    // Should be deduplicated
    expect(passedIds).toHaveLength(2);
    expect(passedIds).toContain('source-1');
    expect(passedIds).toContain('source-2');
  });

  it('passes a supabase client to checkOrphanedSourceIds', async () => {
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set());

    renderHook(() => useCitationOrphans(['source-1']), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockCheckOrphanedSourceIds).toHaveBeenCalled();
    });

    const supabaseArg = mockCheckOrphanedSourceIds.mock.calls[0][1];
    expect(supabaseArg).toBeDefined();
    expect(supabaseArg).toHaveProperty('rpc');
  });

  // -----------------------------------------------------------------------
  // Key-based deduplication -- no re-checking same IDs
  // -----------------------------------------------------------------------

  it('does not re-check when IDs have not changed', async () => {
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set());

    const sourceIds = ['source-1', 'source-2'];
    const { rerender } = renderHook(() => useCitationOrphans(sourceIds), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockCheckOrphanedSourceIds).toHaveBeenCalledTimes(1);
    });

    // Re-render with the same reference -- should not re-check
    rerender();

    await new Promise((r) => setTimeout(r, 50));
    expect(mockCheckOrphanedSourceIds).toHaveBeenCalledTimes(1);
  });

  it('re-checks when source IDs change', async () => {
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set());

    const wrapper = createWrapper();

    const { rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useCitationOrphans(ids),
      { initialProps: { ids: ['source-1'] }, wrapper },
    );

    await waitFor(() => {
      expect(mockCheckOrphanedSourceIds).toHaveBeenCalledTimes(1);
    });

    // Change to different IDs
    rerender({ ids: ['source-3', 'source-4'] });

    await waitFor(() => {
      expect(mockCheckOrphanedSourceIds).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Filters falsy values
  // -----------------------------------------------------------------------

  it('filters out falsy values from source IDs', async () => {
    mockCheckOrphanedSourceIds.mockResolvedValue(new Set());

    renderHook(() => useCitationOrphans(['source-1', '', 'source-2']), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockCheckOrphanedSourceIds).toHaveBeenCalled();
    });

    const passedIds = mockCheckOrphanedSourceIds.mock.calls[0][0];
    expect(passedIds).not.toContain('');
  });
});
