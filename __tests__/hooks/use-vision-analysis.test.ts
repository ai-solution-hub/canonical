import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({ toast: mockToast }));

let mockFetch: ReturnType<typeof vi.fn>;

import { useVisionAnalysis } from '@/hooks/use-vision-analysis';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVisionAnalysis', () => {
  const onAnalysisComplete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        analysis: 'Image contains a diagram',
        model: 'gpt-4o',
        tokens_used: 500,
      }),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with isAnalysing false', () => {
    const { result } = renderHook(
      () => useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isAnalysing).toBe(false);
  });

  it('POSTs to vision endpoint and calls onAnalysisComplete on success', async () => {
    const { result } = renderHook(
      () => useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleVisionAnalysis();
    });

    await waitFor(() => {
      expect(result.current.isAnalysing).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/items/item-1/vision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(onAnalysisComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        analysis: 'Image contains a diagram',
        model: 'gpt-4o',
        tokens_used: 500,
        analysed_at: expect.any(String),
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Visual analysis complete');
  });

  it('shows error toast when API returns non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Unsupported format' }),
    });

    const { result } = renderHook(
      () => useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleVisionAnalysis();
    });

    await waitFor(() => {
      expect(result.current.isAnalysing).toBe(false);
    });

    expect(onAnalysisComplete).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith('Unsupported format');
  });

  it('shows generic error toast on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(
      () => useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
      { wrapper: createWrapper() },
    );

    await act(async () => {
      result.current.handleVisionAnalysis();
    });

    await waitFor(() => {
      expect(result.current.isAnalysing).toBe(false);
    });

    expect(mockToast.error).toHaveBeenCalledWith('Network error');
  });

  it('sets isAnalysing to true during request', async () => {
    let resolveFetch!: (v: unknown) => void;
    mockFetch.mockReturnValue(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );

    const { result } = renderHook(
      () => useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
      { wrapper: createWrapper() },
    );

    act(() => {
      result.current.handleVisionAnalysis();
    });

    await waitFor(() => {
      expect(result.current.isAnalysing).toBe(true);
    });

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({
          analysis: 'done',
          model: 'gpt-4o',
          tokens_used: 100,
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.isAnalysing).toBe(false);
    });
  });
});
