import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

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
    const { result } = renderHook(() =>
      useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
    );

    expect(result.current.isAnalysing).toBe(false);
  });

  it('POSTs to vision endpoint and calls onAnalysisComplete on success', async () => {
    const { result } = renderHook(() =>
      useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
    );

    await act(async () => {
      await result.current.handleVisionAnalysis();
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
    expect(result.current.isAnalysing).toBe(false);
  });

  it('shows error toast when API returns non-ok response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Unsupported format' }),
    });

    const { result } = renderHook(() =>
      useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
    );

    await act(async () => {
      await result.current.handleVisionAnalysis();
    });

    expect(onAnalysisComplete).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith('Unsupported format');
    expect(result.current.isAnalysing).toBe(false);
  });

  it('shows generic error toast on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() =>
      useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
    );

    await act(async () => {
      await result.current.handleVisionAnalysis();
    });

    expect(mockToast.error).toHaveBeenCalledWith('Failed to perform visual analysis');
    expect(result.current.isAnalysing).toBe(false);
  });

  it('sets isAnalysing to true during request', async () => {
    let resolveFetch!: (v: unknown) => void;
    mockFetch.mockReturnValue(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );

    const { result } = renderHook(() =>
      useVisionAnalysis({ itemId: 'item-1', onAnalysisComplete }),
    );

    let promise: Promise<void>;
    act(() => {
      promise = result.current.handleVisionAnalysis();
    });

    expect(result.current.isAnalysing).toBe(true);

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => ({ analysis: 'done', model: 'gpt-4o', tokens_used: 100 }),
      });
      await promise!;
    });

    expect(result.current.isAnalysing).toBe(false);
  });
});
