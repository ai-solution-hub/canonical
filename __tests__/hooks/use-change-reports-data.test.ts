/**
 * useChangeReportsData Hook Tests
 *
 * Tests the TanStack Query-based hook that powers the digest (Change Reports) page.
 * Validates query fetching, mutation handling, cache updates, and error paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

import { useChangeReportsData } from '@/hooks/use-change-reports-data';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChangeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'change-report-1',
    frequency: 'weekly',
    period_start: '2026-03-01T00:00:00Z',
    period_end: '2026-03-08T00:00:00Z',
    item_count: 5,
    domain_summaries: [],
    narrative_summary: 'A narrative summary.',
    generated_at: '2026-03-08T12:00:00Z',
    generated_by: 'system',
    tokens_used: 100,
    item_ids: ['item-1'],
    created_at: '2026-03-08T12:00:00Z',
    ...overrides,
  };
}

function setupFetch(
  options: {
    latest?: Record<string, unknown> | null;
    list?: Record<string, unknown>[];
    detail?: Record<string, unknown> | null;
    generateResult?: Record<string, unknown> | null;
    generateError?: string | null;
  } = {},
) {
  mockFetch.mockImplementation(async (url: string) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    if (urlStr.includes('/api/change-reports/latest')) {
      return {
        ok: true,
        json: async () => ({ digest: options.latest ?? null }),
      };
    }

    if (urlStr.includes('/api/change-reports/list')) {
      return {
        ok: true,
        json: async () => ({ digests: options.list ?? [] }),
      };
    }

    if (urlStr.includes('/api/change-reports/generate')) {
      if (options.generateError) {
        return {
          ok: false,
          json: async () => ({ error: options.generateError }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          digest: options.generateResult ?? makeChangeReport(),
        }),
      };
    }

    // Match /api/change-reports/{id} — the detail endpoint (any non-route ID)
    if (/\/api\/change-reports\/(?!latest|list|generate)[^/]+/.test(urlStr)) {
      return {
        ok: true,
        json: async () => ({ digest: options.detail ?? null }),
      };
    }

    return { ok: true, json: async () => ({}) };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChangeReportsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns loading=true initially then resolves with data', async () => {
    const digest = makeChangeReport();
    setupFetch({ latest: digest, list: [digest] });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentChangeReport).toEqual(digest);
    expect(result.current.pastChangeReports).toEqual([digest]);
  });

  it('returns null digest when none exists', async () => {
    setupFetch({ latest: null, list: [] });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentChangeReport).toBeNull();
    expect(result.current.pastChangeReports).toEqual([]);
  });

  it('generates a digest and updates cache on success', async () => {
    const generated = makeChangeReport({ id: 'new-digest' });
    setupFetch({ latest: null, list: [], generateResult: generated });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleGenerate({
        period_days: 7,
        frequency: 'weekly',
      });
    });

    await waitFor(() => {
      expect(result.current.generating).toBe(false);
    });

    expect(result.current.currentChangeReport).toEqual(generated);
    expect(mockToast.success).toHaveBeenCalledWith(
      'Report generated successfully',
    );
  });

  it('shows error toast when generation fails', async () => {
    setupFetch({ latest: null, list: [], generateError: 'Not enough content' });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.handleGenerate({
        period_days: 7,
        frequency: 'weekly',
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
      if (
        typeof url === 'string' &&
        url.includes('/api/change-reports/latest')
      ) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (
        typeof url === 'string' &&
        url.includes('/api/change-reports/generate')
      ) {
        return new Promise(() => {}); // never resolves
      }
      return { ok: true, json: async () => ({}) };
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.generating).toBe(false);

    act(() => {
      result.current.handleGenerate({
        period_days: 1,
        frequency: 'daily',
      });
    });

    await waitFor(() => {
      expect(result.current.generating).toBe(true);
    });
  });

  // ─── loadChangeReport ─────────────────────────────────────────────────────────

  it('loadChangeReport calls the detail endpoint and updates current digest', async () => {
    const latestDigest = makeChangeReport({ id: 'latest-1' });
    const pastDigest = makeChangeReport({
      id: 'past-1',
      narrative_summary: 'Past report.',
    });
    setupFetch({
      latest: latestDigest,
      list: [latestDigest],
      detail: pastDigest,
    });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.loadChangeReport('past-1');
    });

    // Verify the detail endpoint was called, not the list endpoint
    const fetchCalls = mockFetch.mock.calls.map((call) => call[0]);
    expect(fetchCalls).toContain('/api/change-reports/past-1');

    // The current digest should now be the loaded one
    await waitFor(() => {
      expect(result.current.currentChangeReport).toEqual(pastDigest);
    });
  });

  it('loadChangeReport shows error toast on failure', async () => {
    setupFetch({ latest: null, list: [] });
    // Override to make the detail endpoint fail
    mockFetch.mockImplementation(async (url: string) => {
      const urlStr = typeof url === 'string' ? url : String(url);

      if (urlStr.includes('/api/change-reports/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (urlStr.includes('/api/change-reports/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      // Detail endpoint fails
      if (/\/api\/digest\/(?!latest|list|generate)[^/]+/.test(urlStr)) {
        return { ok: false, json: async () => ({ error: 'Not found' }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.loadChangeReport('nonexistent-id');
    });

    expect(mockToast.error).toHaveBeenCalledWith('Failed to load report');
  });
});
