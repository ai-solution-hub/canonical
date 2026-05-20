/**
 * useBidReadiness hook tests.
 *
 * Covers:
 *   - Successful fetch via TanStack Query
 *   - Error handling
 *   - Loading state
 *   - Refresh functionality (cache invalidation)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useBidReadiness } from '@/hooks/procurement/use-procurement-readiness';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const BID_UUID = '00000000-0000-4000-8000-000000000001';

const readyResponse = {
  ready: true,
  summary: {
    total_questions: 3,
    answered: 3,
    approved: 3,
    quality_checked: 3,
    passing_quality: 3,
  },
  criteria: [
    { name: 'All questions answered', passed: true, details: '3 of 3' },
  ],
  issues: [],
};

// ---------------------------------------------------------------------------
// Helper: wrapper with QueryClientProvider
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
// Tests
// ---------------------------------------------------------------------------

describe('useBidReadiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches readiness data successfully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => readyResponse,
    });

    const { result } = renderHook(() => useBidReadiness(BID_UUID), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.readiness).toEqual(readyResponse);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/procurement/${BID_UUID}/readiness`,
      undefined,
    );
  });

  it('handles fetch error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useBidReadiness(BID_UUID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.readiness).toBeNull();
    expect(result.current.error).toBe('Server error');
  });

  it('handles network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const { result } = renderHook(() => useBidReadiness(BID_UUID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.readiness).toBeNull();
    expect(result.current.error).toBe('Network failure');
  });

  it('starts in loading state', () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => readyResponse,
    });

    const { result } = renderHook(() => useBidReadiness(BID_UUID), {
      wrapper: createWrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.readiness).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('supports refresh via cache invalidation', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => readyResponse,
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ...readyResponse,
          ready: false,
        }),
      });

    const { result } = renderHook(() => useBidReadiness(BID_UUID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.readiness?.ready).toBe(true);

    // Trigger refresh (invalidates cache)
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.readiness?.ready).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('handles error response without JSON body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => {
        throw new Error('not JSON');
      },
    });

    const { result } = renderHook(() => useBidReadiness(BID_UUID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe('Request failed: 403');
  });

  it('does not fetch when procurementId is empty', async () => {
    const { result } = renderHook(() => useBidReadiness(''), {
      wrapper: createWrapper(),
    });

    // Should not be loading and should not have fetched
    await new Promise((r) => setTimeout(r, 50));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.readiness).toBeNull();
  });
});
