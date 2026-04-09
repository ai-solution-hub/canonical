/**
 * useResolveFlags — TanStack Query mutation hook tests.
 *
 * Covers:
 *   - Success path (URL, method, body, data shape)
 *   - Error path (toast.error called with scrubbed message)
 *   - Cache invalidation (BOTH flags.all AND articles.all)
 *   - Success toast wording: singular "1 flag resolved" vs plural "N flags resolved"
 *
 * This is the only destructive mutation in the SI Prompt Refinement flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { useResolveFlags } from '@/hooks/intelligence/use-resolve-flags';
import type {
  ResolveFlagsRequest,
  ResolveFlagsResponse,
} from '@/types/intelligence-refinement';

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
  return {
    queryClient,
    Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

const WORKSPACE_ID = '9f8b7c6d-5e4a-43b2-a190-8c7d6e5f4a3b';
const FLAG_ID_1 = '11111111-2222-4333-a444-555555555555';
const FLAG_ID_2 = '22222222-3333-4444-a555-666666666666';
const FLAG_ID_3 = '33333333-4444-4555-a666-777777777777';
const PROMPT_VERSION_ID = '44444444-5555-4666-a777-888888888888';

const MULTI_REQUEST: ResolveFlagsRequest = {
  flag_ids: [FLAG_ID_1, FLAG_ID_2, FLAG_ID_3],
  resolution_type: 'addressed',
  prompt_version_id: PROMPT_VERSION_ID,
  resolved_notes: 'Resolved via new prompt version v3',
};

const SINGLE_REQUEST: ResolveFlagsRequest = {
  flag_ids: [FLAG_ID_1],
  resolution_type: 'dismissed',
  prompt_version_id: null,
};

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetchOk(response: ResolveFlagsResponse) {
  mockFetch = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => response,
  }));
  vi.stubGlobal('fetch', mockFetch);
}

function stubFetchError(status: number, message: string) {
  mockFetch = vi.fn(async () => ({
    ok: false,
    status,
    json: async () => ({ error: message }),
  }));
  vi.stubGlobal('fetch', mockFetch);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useResolveFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the resolve endpoint with the supplied body and returns the response', async () => {
    stubFetchOk({ resolved_count: 3, requested_count: 3 });
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useResolveFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(MULTI_REQUEST);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/intelligence/workspaces/${WORKSPACE_ID}/flags/resolve`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(MULTI_REQUEST);

    expect(result.current.data).toEqual({
      resolved_count: 3,
      requested_count: 3,
    });
  });

  it('invalidates BOTH intelligence.flags.all and intelligence.articles.all on success', async () => {
    stubFetchOk({ resolved_count: 3, requested_count: 3 });
    const { queryClient, Wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useResolveFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(MULTI_REQUEST);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['intelligence', 'flags', WORKSPACE_ID],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['intelligence', 'articles', WORKSPACE_ID],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it('shows singular success toast "1 flag resolved" when exactly one flag is resolved', async () => {
    stubFetchOk({ resolved_count: 1, requested_count: 1 });
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useResolveFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(SINGLE_REQUEST);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('1 flag resolved');
  });

  it('shows plural success toast "N flags resolved" when multiple flags are resolved', async () => {
    stubFetchOk({ resolved_count: 3, requested_count: 3 });
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useResolveFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(MULTI_REQUEST);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith('3 flags resolved');
  });

  it('does NOT downgrade the success toast when warnings are present (partial-success)', async () => {
    stubFetchOk({
      resolved_count: 2,
      requested_count: 3,
      warnings: ['Flag 33333333 already resolved'],
    });
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useResolveFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(MULTI_REQUEST);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Success toast still fires with the ACTUAL resolved count (2), not the
    // requested count (3). Warnings are the component's responsibility.
    expect(mockToastSuccess).toHaveBeenCalledWith('2 flags resolved');
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('surfaces an error toast with the scrubbed API message on failure', async () => {
    stubFetchError(500, 'Could not resolve flags: DB unavailable');
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useResolveFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      try {
        await result.current.mutateAsync(MULTI_REQUEST);
      } catch {
        // Expected — mutateAsync re-throws on error.
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe(
      'Could not resolve flags: DB unavailable',
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith(
      'Could not resolve flags: DB unavailable',
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('does not invalidate caches when the API returns failure', async () => {
    stubFetchError(500, 'Boom');
    const { queryClient, Wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useResolveFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      try {
        await result.current.mutateAsync(MULTI_REQUEST);
      } catch {
        // Expected.
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
