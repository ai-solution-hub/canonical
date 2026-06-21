// __tests__/hooks/use-content-ingest-polling.test.tsx
/**
 * Unit tests for the folder-drop ingest polling hook ({56.12}, ID-56 Path B).
 *
 * Behaviour-first: drives the hook through its observable lifecycle
 * (idle → pending → ingested) and the error path, mocking only the network
 * boundary (`fetchContentIngestStatus`). Polling cadence is observed via
 * TanStack Query's own refetch, so the test waits on real status transitions
 * rather than asserting on timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetchStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/query/fetchers', () => ({
  fetchContentIngestStatus: mockFetchStatus,
}));

import { useContentIngestPolling } from '@/hooks/use-content-ingest-polling';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

describe('useContentIngestPolling', () => {
  beforeEach(() => {
    mockFetchStatus.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts idle and does not poll until start() is called', () => {
    const { result } = renderHook(() => useContentIngestPolling(), {
      wrapper: createWrapper(),
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.itemId).toBeNull();
    expect(mockFetchStatus).not.toHaveBeenCalled();
  });

  it('transitions pending → ingested when the row appears', async () => {
    // First poll: not yet. Second poll: ingested.
    mockFetchStatus
      .mockResolvedValueOnce({ ingested: false, itemId: null })
      .mockResolvedValue({ ingested: true, itemId: 'item-123' });

    const { result } = renderHook(() => useContentIngestPolling(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.start('report.pdf');
    });

    // Immediately pending (target set, row not yet observed).
    await waitFor(() => expect(result.current.status).toBe('pending'));
    expect(result.current.sourceFile).toBe('report.pdf');

    // Eventually the polled row appears.
    await waitFor(() => expect(result.current.status).toBe('ingested'), {
      timeout: 4000,
    });
    expect(result.current.itemId).toBe('item-123');
  });

  it('surfaces status=error when the poll request throws', async () => {
    mockFetchStatus.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useContentIngestPolling(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.start('broken.pdf');
    });

    await waitFor(() => expect(result.current.status).toBe('error'), {
      timeout: 4000,
    });
    expect(result.current.itemId).toBeNull();
  });

  it('reset() returns the hook to idle and stops polling', async () => {
    mockFetchStatus.mockResolvedValue({ ingested: false, itemId: null });

    const { result } = renderHook(() => useContentIngestPolling(), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.start('report.pdf');
    });
    await waitFor(() => expect(result.current.status).toBe('pending'));

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.sourceFile).toBeNull();
  });

  it('transitions pending → timeout once POLL_TIMEOUT_MS elapses with no row', async () => {
    // The row never lands; the poll must give up after the deadline rather
    // than spin forever. shouldAdvanceTime lets TanStack Query's refetch
    // promises settle while fake timers own the clock (mirrors
    // use-notifications.test.ts).
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockFetchStatus.mockResolvedValue({ ingested: false, itemId: null });

      const { result } = renderHook(() => useContentIngestPolling(), {
        wrapper: createWrapper(),
      });

      act(() => {
        result.current.start('never-lands.pdf');
      });

      await waitFor(() => expect(result.current.status).toBe('pending'));

      // Advance past the 5-min deadline; the next refetchInterval evaluation
      // observes Date.now() > deadline and flips the terminal timeout flag.
      await act(async () => {
        vi.advanceTimersByTime(5 * 60 * 1000 + 2500);
      });

      await waitFor(() => expect(result.current.status).toBe('timeout'));
      expect(result.current.itemId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
