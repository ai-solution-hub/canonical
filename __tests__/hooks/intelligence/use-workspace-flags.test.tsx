/**
 * useWorkspaceFlags — TanStack Query hook tests.
 *
 * Verifies the hook fetches `/api/intelligence/workspaces/:id/flags`,
 * threads optional filters into the query string, and surfaces error state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  useWorkspaceFlags,
  type WorkspaceFlag,
} from '@/hooks/intelligence/use-workspace-flags';

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

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const SAMPLE_FLAG: WorkspaceFlag = {
  id: 'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f8a',
  feed_article_id: 'c3d4e5f6-a7b8-4c9d-9e1f-2a3b4c5d6e7f',
  flag_type: 'false_positive',
  flagged_by: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
  notes: 'Not relevant to our sector',
  resolved: false,
  resolved_at: null,
  resolved_by: null,
  resolved_notes: null,
  resolution_type: null,
  prompt_version_id: null,
  created_at: '2026-03-15T12:00:00Z',
  article_title: 'New cybersecurity regulations announced',
  article_external_url: 'https://www.gov.uk/guidance/cyber-2026',
  article_relevance_score: 0.85,
  article_relevance_reasoning:
    'Directly relevant to security compliance domain',
  article_relevance_category: 'high',
  article_passed: true,
  source_name: 'Gov.uk Security',
};

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetchOk(response: WorkspaceFlag[]) {
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

/** Pull the URL string from the most recent fetch call. */
function lastFetchUrl(): string {
  const calls = mockFetch.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useWorkspaceFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches the flags endpoint without query params when no filters supplied', async () => {
    stubFetchOk([SAMPLE_FLAG]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(lastFetchUrl()).toBe(
      `/api/intelligence/workspaces/${WORKSPACE_ID}/flags`,
    );
    expect(result.current.data).toEqual([SAMPLE_FLAG]);
  });

  it('passes ?resolved=true when the resolved filter is set', async () => {
    stubFetchOk([{ ...SAMPLE_FLAG, resolved: true }]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useWorkspaceFlags(WORKSPACE_ID, { resolved: true }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = lastFetchUrl();
    expect(url).toContain(
      `/api/intelligence/workspaces/${WORKSPACE_ID}/flags?`,
    );
    expect(url).toContain('resolved=true');
    expect(url).not.toContain('flag_type=');
  });

  it('passes ?flag_type=false_positive when only the flag_type filter is set', async () => {
    stubFetchOk([SAMPLE_FLAG]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () => useWorkspaceFlags(WORKSPACE_ID, { flag_type: 'false_positive' }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = lastFetchUrl();
    expect(url).toContain('flag_type=false_positive');
    expect(url).not.toContain('resolved=');
  });

  it('passes both filters when supplied together', async () => {
    stubFetchOk([SAMPLE_FLAG]);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(
      () =>
        useWorkspaceFlags(WORKSPACE_ID, {
          resolved: false,
          flag_type: 'false_negative',
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const url = lastFetchUrl();
    expect(url).toContain('resolved=false');
    expect(url).toContain('flag_type=false_negative');
  });

  it('surfaces error state when the API returns a non-OK response', async () => {
    stubFetchError(500, 'Failed to fetch workspace flags');
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useWorkspaceFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe(
      'Failed to fetch workspace flags',
    );
    expect(result.current.data).toBeUndefined();
  });

  it('does not fetch when workspaceId is empty', async () => {
    stubFetchOk([SAMPLE_FLAG]);
    const { Wrapper } = createWrapper();

    renderHook(() => useWorkspaceFlags(''), { wrapper: Wrapper });

    // Allow any pending microtasks to settle.
    await new Promise((r) => setTimeout(r, 25));

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
