/**
 * useWorkspaceHealth — TanStack Query hook tests.
 *
 * Verifies the hook fetches `/api/intelligence/workspaces/:id/health`,
 * exposes the typed response shape, and surfaces loading + error states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useWorkspaceHealth,
  type WorkspaceHealthResponse,
} from '@/hooks/intelligence/use-workspace-health';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return {
    queryClient,
    Wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children,
      );
    },
  };
}

const HEALTHY_RESPONSE: WorkspaceHealthResponse = {
  pipeline: {
    lastSuccessfulRun: '2026-04-06T10:00:00.000Z',
    timeSinceLastRunMs: 12 * 60 * 1000,
    sourcesWithFailures: 0,
    sourcesAtFailureLimit: 0,
    totalActiveSources: 4,
    healthy: true,
    statusMessage: 'Pipeline is healthy',
  },
  sources: {
    workspaceId: 'ws-1',
    sources: [
      {
        id: 's1',
        name: 'DfE Feed',
        url: 'https://www.gov.uk/feed',
        lastPolledAt: '2026-04-06T09:30:00.000Z',
        lastPolledStatus: 'success',
        lastPolledError: null,
        consecutiveFailures: 0,
        pollingIntervalMinutes: 30,
        articleCount: 42,
      },
    ],
    healthySources: 1,
    failingSources: 0,
    disabledSources: 0,
  },
};

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetch(response: WorkspaceHealthResponse) {
  mockFetch = vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    url,
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

describe('useWorkspaceHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches from the correct workspace health URL', async () => {
    stubFetch(HEALTHY_RESPONSE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceHealth('ws-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/intelligence/workspaces/ws-1/health',
      undefined,
    );
  });

  it('returns the expected pipeline + sources shape on success', async () => {
    stubFetch(HEALTHY_RESPONSE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceHealth('ws-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data?.pipeline.healthy).toBe(true);
    expect(result.current.data?.pipeline.statusMessage).toBe(
      'Pipeline is healthy',
    );
    expect(result.current.data?.pipeline.totalActiveSources).toBe(4);
    expect(result.current.data?.sources.workspaceId).toBe('ws-1');
    expect(result.current.data?.sources.sources).toHaveLength(1);
    expect(result.current.data?.sources.sources[0].name).toBe('DfE Feed');
    expect(result.current.data?.sources.healthySources).toBe(1);
  });

  it('exposes a loading state before the request resolves', () => {
    stubFetch(HEALTHY_RESPONSE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceHealth('ws-1'), {
      wrapper: Wrapper,
    });

    // Synchronously after render the query should still be loading.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it('surfaces error state when the API returns a non-OK response', async () => {
    stubFetchError(500, 'Failed to fetch pipeline health');
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceHealth('ws-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe(
      'Failed to fetch pipeline health',
    );
    expect(result.current.data).toBeUndefined();
  });

  it('does not fetch when workspaceId is empty', async () => {
    stubFetch(HEALTHY_RESPONSE);
    const { Wrapper } = createWrapper();

    renderHook(() => useWorkspaceHealth(''), { wrapper: Wrapper });

    // Give the query a moment to (not) run
    await new Promise((r) => setTimeout(r, 50));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns failing-state pipeline data when the API reports unhealthy', async () => {
    const failingResponse: WorkspaceHealthResponse = {
      pipeline: {
        lastSuccessfulRun: '2026-04-04T10:00:00.000Z',
        timeSinceLastRunMs: 48 * 60 * 60 * 1000,
        sourcesWithFailures: 3,
        sourcesAtFailureLimit: 1,
        totalActiveSources: 5,
        healthy: false,
        statusMessage: '1 source(s) at failure limit',
      },
      sources: {
        workspaceId: 'ws-1',
        sources: [],
        healthySources: 2,
        failingSources: 3,
        disabledSources: 1,
      },
    };
    stubFetch(failingResponse);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceHealth('ws-1'), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.data).toBeDefined();
    });

    expect(result.current.data?.pipeline.healthy).toBe(false);
    expect(result.current.data?.pipeline.sourcesAtFailureLimit).toBe(1);
    expect(result.current.data?.pipeline.statusMessage).toContain(
      'failure limit',
    );
    expect(result.current.data?.sources.disabledSources).toBe(1);
  });
});
