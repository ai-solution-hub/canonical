/**
 * useDigestData Hook Tests
 *
 * Tests the TanStack Query-based hook that powers the digest (Change Reports) page.
 * Validates query fetching, mutation handling, cache updates, and error paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

import { useDigestData } from '@/hooks/use-digest-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDigest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'digest-1',
    digest_type: 'weekly',
    period_start: '2026-03-01T00:00:00Z',
    period_end: '2026-03-08T00:00:00Z',
    item_count: 5,
    domain_summaries: [],
    theme_clusters: [],
    narrative_summary: 'A narrative summary.',
    generated_at: '2026-03-08T12:00:00Z',
    generated_by: 'system',
    tokens_used: 100,
    item_ids: ['item-1'],
    created_at: '2026-03-08T12:00:00Z',
    ...overrides,
  };
}

function setupFetch(options: {
  latest?: Record<string, unknown> | null;
  list?: Record<string, unknown>[];
  generateResult?: Record<string, unknown> | null;
  generateError?: string | null;
} = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    if (urlStr.includes('/api/digest/latest')) {
      return {
        ok: true,
        json: async () => ({ digest: options.latest ?? null }),
      };
    }

    if (urlStr.includes('/api/digest/list')) {
      return {
        ok: true,
        json: async () => ({ digests: options.list ?? [] }),
      };
    }

    if (urlStr.includes('/api/digest/generate')) {
      if (options.generateError) {
        return {
          ok: false,
          json: async () => ({ error: options.generateError }),
        };
      }
      return {
        ok: true,
        json: async () => ({ digest: options.generateResult ?? makeDigest() }),
      };
    }

    return { ok: true, json: async () => ({}) };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDigestData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns loading=true initially then resolves with data', async () => {
    const digest = makeDigest();
    setupFetch({ latest: digest, list: [digest] });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useDigestData(), { wrapper: Wrapper });

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentDigest).toEqual(digest);
    expect(result.current.pastDigests).toEqual([digest]);
  });

  it('returns null digest when none exists', async () => {
    setupFetch({ latest: null, list: [] });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useDigestData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentDigest).toBeNull();
    expect(result.current.pastDigests).toEqual([]);
  });

  it('generates a digest and updates cache on success', async () => {
    const generated = makeDigest({ id: 'new-digest' });
    setupFetch({ latest: null, list: [], generateResult: generated });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useDigestData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleGenerate({
        period_days: 7,
        digest_type: 'weekly',
      });
    });

    await waitFor(() => {
      expect(result.current.generating).toBe(false);
    });

    expect(result.current.currentDigest).toEqual(generated);
    expect(mockToast.success).toHaveBeenCalledWith('Report generated successfully');
  });

  it('shows error toast when generation fails', async () => {
    setupFetch({ latest: null, list: [], generateError: 'Not enough content' });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useDigestData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleGenerate({
        period_days: 7,
        digest_type: 'weekly',
      });
    });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Not enough content');
    });
  });

  it('tracks generating state during mutation', async () => {
    setupFetch({ latest: null, list: [] });
    // Make generate hang
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/digest/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/generate')) {
        return new Promise(() => {}); // never resolves
      }
      return { ok: true, json: async () => ({}) };
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useDigestData(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.generating).toBe(false);

    act(() => {
      result.current.handleGenerate({
        period_days: 1,
        digest_type: 'daily',
      });
    });

    await waitFor(() => {
      expect(result.current.generating).toBe(true);
    });
  });
});
