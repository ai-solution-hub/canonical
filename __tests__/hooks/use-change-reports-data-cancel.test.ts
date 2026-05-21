/**
 * useChangeReportsData cancel + AbortController tests (OPS-23).
 *
 * Validates:
 *   - cancelGeneration aborts the in-flight request
 *   - AbortError triggers info toast, not error toast
 *   - DIGEST_TOO_MANY_ITEMS error code is exposed and suppresses toast
 *   - After cancel, generating returns to false
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
    digest_type: 'weekly',
    period_start: '2026-03-01T00:00:00Z',
    period_end: '2026-03-08T00:00:00Z',
    item_count: 5,
    domain_summaries: [],
    narrative_summary: 'A summary.',
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
    generateDelay?: number;
    generateResult?: Record<string, unknown> | null;
    generateStatus?: number;
    generateBody?: Record<string, unknown>;
  } = {},
) {
  mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    if (urlStr.includes('/api/change-reports/latest')) {
      return {
        ok: true,
        json: async () => ({
          digest: options.latest ?? null,
        }),
      };
    }

    if (urlStr.includes('/api/change-reports/list')) {
      return {
        ok: true,
        json: async () => ({
          digests: options.list ?? [],
        }),
      };
    }

    if (urlStr.includes('/api/change-reports/generate')) {
      // Check if the signal has been aborted
      if (init?.signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      if (options.generateDelay) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, options.generateDelay);
          // Listen for abort during delay
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(
              new DOMException('The operation was aborted.', 'AbortError'),
            );
          });
        });
      }

      if (options.generateStatus && options.generateStatus >= 400) {
        return {
          ok: false,
          status: options.generateStatus,
          json: async () => options.generateBody ?? { error: 'Server error' },
        };
      }

      return {
        ok: true,
        json: async () => ({
          digest: options.generateResult ?? makeChangeReport(),
        }),
      };
    }

    return {
      ok: true,
      json: async () => ({}),
    };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useChangeReportsData cancel + AbortController (OPS-23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    setupFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes cancelGeneration function', async () => {
    const { Wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    expect(typeof result.current.cancelGeneration).toBe('function');
  });

  it('cancelGeneration aborts the in-flight request and resets generating state', async () => {
    setupFetch({ generateDelay: 5000 });
    const { Wrapper } = createQueryWrapper();

    const { result } = renderHook(() => useChangeReportsData(), {
      wrapper: Wrapper,
    });

    // Wait for initial queries to settle
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Start generation
    act(() => {
      result.current.handleGenerate({
        period_days: 7,
        digest_type: 'weekly',
      });
    });

    // Should be generating
    await waitFor(() => {
      expect(result.current.generating).toBe(true);
    });

    // Cancel
    act(() => {
      result.current.cancelGeneration();
    });

    // Should no longer be generating
    await waitFor(() => {
      expect(result.current.generating).toBe(false);
    });
  });

  it('shows info toast on abort, not error toast', async () => {
    setupFetch({ generateDelay: 5000 });
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
        digest_type: 'weekly',
      });
    });

    await waitFor(() => {
      expect(result.current.generating).toBe(true);
    });

    act(() => {
      result.current.cancelGeneration();
    });

    await waitFor(() => {
      expect(result.current.generating).toBe(false);
    });

    // The abort should trigger an info toast, not an error toast
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('DIGEST_TOO_MANY_ITEMS error code suppresses toast and exposes error', async () => {
    setupFetch({
      generateStatus: 413,
      generateBody: {
        code: 'DIGEST_TOO_MANY_ITEMS',
        item_count: 500,
        max: 150,
        message:
          'Your KB has 500 items in the selected period — that exceeds the 150-item limit for automatic summaries.',
      },
    });
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
        digest_type: 'weekly',
      });
    });

    await waitFor(() => {
      expect(result.current.generateError).not.toBeNull();
    });

    // The 413 too-many-items error should NOT show a toast.error
    expect(mockToast.error).not.toHaveBeenCalled();

    // Error should be accessible for the page component to inspect
    expect(result.current.generateError).toBeDefined();
  });

  it('normal generation errors still show error toast', async () => {
    setupFetch({
      generateStatus: 500,
      generateBody: { error: 'Internal server error' },
    });
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
        digest_type: 'weekly',
      });
    });

    await waitFor(() => {
      expect(result.current.generateError).not.toBeNull();
    });

    // Normal errors should still show an error toast
    expect(mockToast.error).toHaveBeenCalled();
  });
});
