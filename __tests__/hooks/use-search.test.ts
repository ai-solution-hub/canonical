import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSearch } from '@/hooks/use-search';

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

describe('useSearch', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockSuccessResponse(results: unknown[] = [], count = 0) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results, count }),
    });
  }

  function mockErrorResponse(status = 500, body: Record<string, unknown> = { error: 'Internal error' }) {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => body,
    });
  }

  // ----------------------------------------------------------
  // Initial state
  // ----------------------------------------------------------

  it('returns empty initial state', () => {
    const { result } = renderHook(() => useSearch(), {
      wrapper: createWrapper(),
    });
    expect(result.current.results).toEqual([]);
    expect(result.current.count).toBe(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // ----------------------------------------------------------
  // Successful search
  // ----------------------------------------------------------

  it('sets isLoading during search and returns results', async () => {
    const fakeResults = [{ id: '1', title: 'Test item', similarity: 0.9 }];
    mockSuccessResponse(fakeResults, 1);

    const { result } = renderHook(() => useSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('test query');
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.results).toEqual(fakeResults);
      expect(result.current.count).toBe(1);
      expect(result.current.error).toBeNull();
    });
  });

  it('sends the correct POST request with query, threshold, and limit', async () => {
    mockSuccessResponse();

    const { result } = renderHook(() => useSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('kb query', 0.5, 10);
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/search',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'kb query', threshold: 0.5, limit: 10 }),
      }),
    );
  });

  // ----------------------------------------------------------
  // Empty / whitespace query
  // ----------------------------------------------------------

  it('clears results for empty query without making a fetch call', async () => {
    const { result } = renderHook(() => useSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('   ');
    });

    // Wait a tick for any async effects
    await waitFor(() => {
      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.current.results).toEqual([]);
      expect(result.current.count).toBe(0);
    });
  });

  // ----------------------------------------------------------
  // Error handling
  // ----------------------------------------------------------

  it('sets error state on failed response', async () => {
    mockErrorResponse(500, { error: 'Something went wrong' });

    const { result } = renderHook(() => useSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('bad query');
    });

    await waitFor(() => {
      expect(result.current.error).toBe('Something went wrong');
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('shows embedding-specific error message for EMBEDDING_FAILED code', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ code: 'EMBEDDING_FAILED', error: 'Embedding failed' }),
    });

    const { result } = renderHook(() => useSearch(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.search('query');
    });

    await waitFor(() => {
      expect(result.current.error).toContain('embedding service');
    });
  });

  // ----------------------------------------------------------
  // AbortController — cancels previous request
  // ----------------------------------------------------------

  it('aborts previous request when a new search starts', async () => {
    const abortSpy = vi.fn();
    let callCount = 0;

    mockFetch.mockImplementation((_url: string, options: RequestInit) => {
      callCount++;
      // Capture the abort handler of the first call's signal
      if (callCount === 1) {
        options.signal?.addEventListener('abort', abortSpy);
        // Return a response that never resolves (simulates slow request)
        return new Promise(() => {});
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ results: [], count: 0 }),
      });
    });

    const { result } = renderHook(() => useSearch(), {
      wrapper: createWrapper(),
    });

    // Fire first search (will hang)
    act(() => {
      result.current.search('first query');
    });

    // Fire second search — should abort the first
    act(() => {
      result.current.search('second query');
    });

    await waitFor(() => {
      expect(abortSpy).toHaveBeenCalledOnce();
    });
  });
});
