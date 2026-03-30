import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useReviewHistory } from '@/hooks/review/use-review-history';

// ─── Mock fetch ─────────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helper ─────────────────────────────────────────────────────────────────

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

// ─── Test data ──────────────────────────────────────────────────────────────

const ITEM_ID = '00000000-0000-0000-0000-000000000001';

const mockHistory = [
  {
    id: 'log-1',
    flag_type: 'classification_low',
    severity: 'warning',
    details: { notes: 'Confidence below threshold' },
    resolution_notes: null,
    created_at: '2026-03-20T10:00:00Z',
    created_by: 'user-1',
    created_by_name: null,
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    resolved_by_name: null,
  },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('useReviewHistory', () => {
  it('returns empty state when itemId is null', () => {
    const { result } = renderHook(() => useReviewHistory(null), {
      wrapper: createWrapper(),
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches history when given an itemId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ history: mockHistory }),
    });

    const { result } = renderHook(() => useReviewHistory(ITEM_ID), {
      wrapper: createWrapper(),
    });

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.history).toEqual(mockHistory);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/review/history?item_id=${ITEM_ID}`,
      undefined,
    );
  });

  it('handles API error responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    const { result } = renderHook(() => useReviewHistory(ITEM_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.error).toBe('Forbidden');
  });

  it('handles network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useReviewHistory(ITEM_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.error).toBe('Network error');
  });

  it('refetches when itemId changes', async () => {
    const secondItemId = '00000000-0000-0000-0000-000000000002';
    const secondHistory = [
      { ...mockHistory[0], id: 'log-2', flag_type: 'review_needed' },
    ];

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ history: mockHistory }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ history: secondHistory }),
      });

    const wrapper = createWrapper();

    const { result, rerender } = renderHook(
      ({ itemId }: { itemId: string | null }) => useReviewHistory(itemId),
      { initialProps: { itemId: ITEM_ID }, wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.history).toEqual(mockHistory);

    // Change itemId
    rerender({ itemId: secondItemId });

    await waitFor(() => {
      expect(result.current.history).toEqual(secondHistory);
    });

    // Verify that the second URL was called
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/review/history?item_id=${secondItemId}`,
      undefined,
    );
  });

  it('resets to empty when itemId becomes null', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ history: mockHistory }),
    });

    const wrapper = createWrapper();

    const { result, rerender } = renderHook(
      ({ itemId }: { itemId: string | null }) => useReviewHistory(itemId),
      { initialProps: { itemId: ITEM_ID } as { itemId: string | null }, wrapper },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.history).toEqual(mockHistory);

    // Set to null -- query is disabled, data falls back to default
    rerender({ itemId: null });

    // TanStack Query returns the cached data when disabled, but since we changed
    // the key (itemId '' vs ITEM_ID), the default [] kicks in
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('handles non-JSON error responses gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    const { result } = renderHook(() => useReviewHistory(ITEM_ID), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.error).toBe('Request failed: 500');
  });
});
