/**
 * useAnalyseFlags — TanStack Query mutation hook tests.
 *
 * Covers:
 *   - Success path (URL, method, body, data shape)
 *   - Error path (toast.error called with scrubbed message)
 *
 * The analyse endpoint is non-destructive so there is no invalidation
 * assertion here. The hook also intentionally fires no success toast —
 * the analysis result IS the user feedback.
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

import { useAnalyseFlags } from '@/hooks/intelligence/use-analyse-flags';
import type {
  AnalyseFlagsRequest,
  AnalyseFlagsResponse,
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

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const FLAG_ID_1 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const FLAG_ID_2 = '6ba7b811-9dad-41d1-80b4-00c04fd430c8';

const SAMPLE_REQUEST: AnalyseFlagsRequest = {
  flag_ids: [FLAG_ID_1, FLAG_ID_2],
};

const SAMPLE_RESPONSE: AnalyseFlagsResponse = {
  summary: 'Two false positives about unrelated commercial topics.',
  falsePositivePatterns: [
    {
      pattern: 'Commercial procurement coverage',
      articleCount: 2,
      articles: [FLAG_ID_1, FLAG_ID_2],
      rootCause:
        'Scoring prompt does not exclude generic commercial procurement.',
    },
  ],
  falseNegativePatterns: [],
  recommendations: [
    {
      type: 'add',
      section: 'Exclusions',
      currentText: null,
      proposedText:
        'Exclude articles whose primary focus is commercial procurement.',
      reasoning: 'Removes the dominant false-positive cluster.',
      affectedFlags: 2,
    },
  ],
  proposedPromptText:
    'Refined prompt: exclude commercial procurement content...',
  confidenceNotes: 'High confidence — 2 of 2 flags fit a single pattern.',
  analysedFlagCount: 2,
  truncated: false,
};

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetchOk(response: AnalyseFlagsResponse) {
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

describe('useAnalyseFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the analyse endpoint with the supplied body and returns the response', async () => {
    stubFetchOk(SAMPLE_RESPONSE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAnalyseFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync(SAMPLE_REQUEST);
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/intelligence/workspaces/${WORKSPACE_ID}/flags/analyse`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(SAMPLE_REQUEST);

    expect(result.current.data).toEqual(SAMPLE_RESPONSE);
    // Non-destructive: no success toast for the analyse endpoint.
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('surfaces an error toast with the scrubbed API message on failure', async () => {
    stubFetchError(500, 'Flag analyser unavailable');
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useAnalyseFlags(WORKSPACE_ID), {
      wrapper: Wrapper,
    });

    await act(async () => {
      try {
        await result.current.mutateAsync(SAMPLE_REQUEST);
      } catch {
        // Expected — mutateAsync re-throws on error.
      }
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe(
      'Flag analyser unavailable',
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith('Flag analyser unavailable');
  });
});
