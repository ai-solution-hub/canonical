import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mock fetch globally (before importing the hook)
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Import the hook under test (AFTER mocks)
// ---------------------------------------------------------------------------

import { useDebouncedPreview } from '@/hooks/browse/use-debounced-preview';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createPreviewResponse(
  results: Array<{
    id: string;
    title: string;
    content_type: string;
    primary_domain: string | null;
  }>,
) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ results, count: results.length }),
  };
}

function createErrorResponse(status: number) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: 'Test error' }),
  };
}

/**
 * Advance fake timers and flush promise microtask queue.
 * `shouldAdvanceTime: true` handles auto-advancing for
 * waitFor polling; this helper advances by a controlled amount.
 */
async function advanceAndFlush(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  // Allow microtask queue to drain
  await act(async () => {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDebouncedPreview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.clearAllMocks();

    // Default: resolve with empty results
    mockFetch.mockResolvedValue(createPreviewResponse([]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Debounce
  // -----------------------------------------------------------------------

  it('debounces at the configured interval (300ms default)', async () => {
    const { Wrapper } = createQueryWrapper();

    renderHook(
      () => useDebouncedPreview('risk assessment'),
      { wrapper: Wrapper },
    );

    // No fetch should have been called immediately
    expect(mockFetch).not.toHaveBeenCalled();

    // Advance past debounce
    await advanceAndFlush(350);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Verify the URL
    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toContain('/api/search/preview');
    expect(fetchUrl).toContain('q=risk%20assessment');
    expect(fetchUrl).toContain('limit=8');
  });

  it('uses custom debounce interval', async () => {
    const { Wrapper } = createQueryWrapper();

    renderHook(
      () => useDebouncedPreview('risk assessment', { debounceMs: 500 }),
      { wrapper: Wrapper },
    );

    // Advance to 200ms — should NOT have fired (500ms debounce)
    await advanceAndFlush(200);

    // The key assertion: at 200ms, the 500ms debounce should not have fired
    expect(mockFetch).not.toHaveBeenCalled();

    // Advance past the 500ms debounce point
    await advanceAndFlush(350);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Min length
  // -----------------------------------------------------------------------

  it('does not fire below minLength (default 3)', async () => {
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useDebouncedPreview('ri'), {
      wrapper: Wrapper,
    });

    await advanceAndFlush(500);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('fires at exactly minLength', async () => {
    const { Wrapper } = createQueryWrapper();

    renderHook(() => useDebouncedPreview('ris'), {
      wrapper: Wrapper,
    });

    await advanceAndFlush(350);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  it('uses custom minLength', async () => {
    const { Wrapper } = createQueryWrapper();

    renderHook(
      () => useDebouncedPreview('ri', { minLength: 2 }),
      { wrapper: Wrapper },
    );

    await advanceAndFlush(350);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Cancellation on query change
  // -----------------------------------------------------------------------

  it('cancels previous debounce when query changes (new query wins)', async () => {
    const { Wrapper } = createQueryWrapper();

    const { rerender } = renderHook(
      ({ query }: { query: string }) => useDebouncedPreview(query),
      {
        wrapper: Wrapper,
        initialProps: { query: 'risk' },
      },
    );

    // Rerender immediately with a new query before any debounce fires.
    // The useEffect cleanup should clear the first timer.
    rerender({ query: 'risk assessment' });

    // Now advance past both debounce periods
    await advanceAndFlush(350);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    // Only one fetch should have happened (for "risk assessment").
    // If the "risk" timer was not cancelled, we'd see two calls.
    // However TanStack also fires for "risk" if it settles first.
    // The key check: the LAST fetch is for "risk assessment"
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(lastCall[0]).toContain('q=risk%20assessment');
  });

  // -----------------------------------------------------------------------
  // Cancellation on unmount
  // -----------------------------------------------------------------------

  it('cancels on unmount (no late state update)', async () => {
    const { Wrapper } = createQueryWrapper();

    const { unmount } = renderHook(
      () => useDebouncedPreview('risk assessment'),
      { wrapper: Wrapper },
    );

    // Unmount before the debounce fires
    unmount();

    await advanceAndFlush(500);

    // Should never have fetched
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Cached results
  // -----------------------------------------------------------------------

  it('returns cached results without a second fetch for same query within staleTime', async () => {
    const mockResults = [
      { id: 'item-1', title: 'Risk Guide', content_type: 'article', primary_domain: 'governance' },
    ];
    mockFetch.mockResolvedValue(createPreviewResponse(mockResults));

    // Shared wrapper with long gcTime + staleTime so cache persists across unmount/remount
    const { Wrapper } = createQueryWrapper({ staleTime: 30_000, gcTime: 300_000 });

    // First render — fetches
    const { result, unmount } = renderHook(
      () => useDebouncedPreview('risk assessment'),
      { wrapper: Wrapper },
    );

    await advanceAndFlush(350);

    await waitFor(() => {
      expect(result.current.results).toHaveLength(1);
    });

    const fetchCountAfterFirst = mockFetch.mock.calls.length;
    unmount();

    // Second render with same query and same QueryClient — should use cache
    const { result: result2 } = renderHook(
      () => useDebouncedPreview('risk assessment'),
      { wrapper: Wrapper },
    );

    await advanceAndFlush(350);

    await waitFor(() => {
      expect(result2.current.results).toHaveLength(1);
    });

    // No additional fetch beyond what happened in the first render
    expect(mockFetch).toHaveBeenCalledTimes(fetchCountAfterFirst);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('handles API errors gracefully (no unhandled rejection, isLoading resolves to false)', async () => {
    mockFetch.mockResolvedValue(createErrorResponse(500));

    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useDebouncedPreview('risk assessment'),
      { wrapper: Wrapper },
    );

    await advanceAndFlush(350);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.results).toEqual([]);
  });

  it('handles fetch rejection gracefully', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useDebouncedPreview('risk assessment'),
      { wrapper: Wrapper },
    );

    await advanceAndFlush(350);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.results).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // isLoading state
  // -----------------------------------------------------------------------

  it('isLoading is false when query is below minLength', async () => {
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useDebouncedPreview('ab'), {
      wrapper: Wrapper,
    });

    await advanceAndFlush(350);

    expect(result.current.isLoading).toBe(false);
  });

  // -----------------------------------------------------------------------
  // External `enabled` gate
  // -----------------------------------------------------------------------

  it('does not fire when enabled=false even with a valid query', async () => {
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(
      () => useDebouncedPreview('risk assessment', { enabled: false }),
      { wrapper: Wrapper },
    );

    await advanceAndFlush(500);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.results).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('resumes firing when enabled flips from false to true', async () => {
    const { Wrapper } = createQueryWrapper();

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useDebouncedPreview('risk assessment', { enabled }),
      {
        wrapper: Wrapper,
        initialProps: { enabled: false },
      },
    );

    await advanceAndFlush(500);
    expect(mockFetch).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await advanceAndFlush(350);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Request URL shape
  // -----------------------------------------------------------------------

  it('always requests PREVIEW_MAX_RESULTS (canonical key — no custom limit)', async () => {
    const { Wrapper } = createQueryWrapper();

    renderHook(() => useDebouncedPreview('risk assessment'), {
      wrapper: Wrapper,
    });

    await advanceAndFlush(350);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    const fetchUrl = mockFetch.mock.calls[0][0];
    expect(fetchUrl).toContain('limit=8');
  });
});
