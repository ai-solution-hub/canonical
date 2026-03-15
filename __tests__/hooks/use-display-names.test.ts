import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;

function createFetchMock(responseData: Record<string, string> = {}) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => responseData,
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useDisplayNames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = createFetchMock({
      'user-1': 'Alice Smith',
      'user-2': 'Bob Jones',
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Reset module to clear module-level cache between tests
    vi.resetModules();
  });

  async function importHook() {
    const mod = await import('@/hooks/use-display-names');
    return mod.useDisplayNames;
  }

  // -----------------------------------------------------------------------
  // Basic resolution
  // -----------------------------------------------------------------------

  it('returns empty map for empty input', async () => {
    const useDisplayNames = await importHook();
    const { result } = renderHook(() => useDisplayNames([]));
    expect(result.current.size).toBe(0);
  });

  it('returns empty map for null/undefined IDs', async () => {
    const useDisplayNames = await importHook();
    const { result } = renderHook(() => useDisplayNames([null, undefined, '']));
    expect(result.current.size).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches and resolves user IDs to display names', async () => {
    const useDisplayNames = await importHook();
    const { result } = renderHook(() => useDisplayNames(['user-1', 'user-2']));

    await waitFor(() => {
      expect(result.current.size).toBe(2);
    });

    expect(result.current.get('user-1')).toBe('Alice Smith');
    expect(result.current.get('user-2')).toBe('Bob Jones');
  });

  it('sends POST request with IDs to display-names endpoint', async () => {
    const useDisplayNames = await importHook();
    renderHook(() => useDisplayNames(['user-1']));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/users/display-names', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: expect.any(String),
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.ids).toContain('user-1');
  });

  // -----------------------------------------------------------------------
  // Cache behaviour
  // -----------------------------------------------------------------------

  it('serves from cache on subsequent renders with same IDs', async () => {
    const useDisplayNames = await importHook();

    const { result, rerender } = renderHook(() =>
      useDisplayNames(['user-1']),
    );

    await waitFor(() => {
      expect(result.current.size).toBe(1);
    });

    const fetchCountAfterFirst = mockFetch.mock.calls.length;

    // Re-render with same IDs — should use cache
    rerender();

    await waitFor(() => {
      expect(result.current.get('user-1')).toBe('Alice Smith');
    });

    // No additional fetch calls
    expect(mockFetch.mock.calls.length).toBe(fetchCountAfterFirst);
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it('handles fetch failure gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockFetch = vi.fn(async () => {
      throw new Error('Network error');
    });
    vi.stubGlobal('fetch', mockFetch);

    const useDisplayNames = await importHook();
    const { result } = renderHook(() => useDisplayNames(['user-1']));

    // Should not crash — returns empty map
    await new Promise((r) => setTimeout(r, 100));
    expect(result.current.size).toBe(0);

    consoleSpy.mockRestore();
  });

  it('handles non-ok response gracefully', async () => {
    mockFetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({}),
    }));
    vi.stubGlobal('fetch', mockFetch);

    const useDisplayNames = await importHook();
    const { result } = renderHook(() => useDisplayNames(['user-1']));

    await new Promise((r) => setTimeout(r, 100));
    // Should not crash, just returns empty map
    expect(result.current.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Deduplication — same IDs only trigger one fetch
  // -----------------------------------------------------------------------

  it('only makes one fetch call for duplicate IDs across re-renders', async () => {
    const useDisplayNames = await importHook();
    const { result, rerender } = renderHook(() =>
      useDisplayNames(['user-1', 'user-1', 'user-1']),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Re-render with same duplicated IDs — idsRef guard prevents re-fetch
    rerender();

    await waitFor(() => {
      expect(result.current.get('user-1')).toBe('Alice Smith');
    });

    // Still only one fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
