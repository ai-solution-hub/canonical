/**
 * useRescoringPreview — TanStack Query mutation hook tests.
 *
 * Covers:
 *   - Success path (URL, method, body, data shape including warnings)
 *   - Error path (toast.error called with scrubbed message)
 *
 * The preview endpoint is non-destructive: no cache invalidation, no
 * success toast. Warnings are passed through in `data.warnings` for the
 * component to surface — the hook must NOT touch them.
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

import { useRescoringPreview } from '@/hooks/intelligence/use-rescoring-preview';
import type {
  RescoringPreviewRequest,
  RescoringPreviewResponse,
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

const WORKSPACE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const ARTICLE_ID_1 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const ARTICLE_ID_2 = '123e4567-e89b-42d3-a456-556642440000';

const SAMPLE_REQUEST: RescoringPreviewRequest = {
  prompt_text:
    'Score each article between 0 and 1 for relevance to UK cyber regulation.',
  sample_size: 10,
  include_scored: true,
};

const SAMPLE_RESPONSE: RescoringPreviewResponse = {
  samples: 2,
  mean_delta: 0.1,
  improved: 1,
  regressed: 0,
  results: [
    {
      article_id: ARTICLE_ID_1,
      title: 'New UK cybersecurity guidance published',
      existing_score: 0.6,
      candidate_score: 0.8,
      score_delta: 0.2,
      existing_reasoning: 'Mentions security but lacks specificity.',
      candidate_reasoning:
        'Directly addresses UK cyber compliance obligations.',
    },
    {
      article_id: ARTICLE_ID_2,
      title: 'Generic commercial procurement update',
      existing_score: 0.5,
      candidate_score: 0.5,
      score_delta: 0,
      existing_reasoning: 'Unclear sector focus.',
      candidate_reasoning: 'Unclear sector focus.',
    },
  ],
  warnings: ['Article 3 skipped: missing body text'],
};

let mockFetch: ReturnType<typeof vi.fn>;

function stubFetchOk(response: RescoringPreviewResponse) {
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

describe('useRescoringPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the preview endpoint and returns the full response including warnings', async () => {
    stubFetchOk(SAMPLE_RESPONSE);
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRescoringPreview(WORKSPACE_ID), {
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
      `/api/intelligence/workspaces/${WORKSPACE_ID}/prompts/preview`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual(SAMPLE_REQUEST);

    expect(result.current.data).toEqual(SAMPLE_RESPONSE);
    // Warnings MUST be passed through untouched on `data` for the component
    // to surface — the hook does not transform or toast on them.
    expect(result.current.data?.warnings).toEqual([
      'Article 3 skipped: missing body text',
    ]);
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('surfaces an error toast with the scrubbed API message on failure', async () => {
    stubFetchError(500, 'Scoring engine unavailable');
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useRescoringPreview(WORKSPACE_ID), {
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
      'Scoring engine unavailable',
    );
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockToastError).toHaveBeenCalledWith('Scoring engine unavailable');
  });
});
