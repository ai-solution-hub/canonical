/**
 * useCoverageTargets hook tests.
 *
 * Covers:
 *   - Successful fetch
 *   - Error handling
 *   - Loading state
 *   - saveTargets: success and error
 *   - refetch after save
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useCoverageTargets } from '@/hooks/use-coverage-targets';

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const DOMAIN_UUID = '00000000-0000-4000-8000-000000000001';

const mockTargets = [
  {
    id: '00000000-0000-4000-8000-000000000010',
    domain_id: DOMAIN_UUID,
    metric_name: 'item_count' as const,
    target_value: 10,
    domain_name: 'Compliance',
  },
  {
    id: '00000000-0000-4000-8000-000000000011',
    domain_id: DOMAIN_UUID,
    metric_name: 'fresh_pct' as const,
    target_value: 80,
    domain_name: 'Compliance',
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCoverageTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches targets on mount', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ targets: mockTargets }),
    });

    const { result } = renderHook(() => useCoverageTargets());

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.targets).toEqual(mockTargets);
    expect(result.current.error).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith('/api/coverage/targets');
  });

  it('handles fetch error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });

    const { result } = renderHook(() => useCoverageTargets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Server error');
    expect(result.current.targets).toEqual([]);
  });

  it('handles network failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useCoverageTargets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network error');
  });

  it('saveTargets calls PUT and refetches on success', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ targets: [] }),
    });

    const { result } = renderHook(() => useCoverageTargets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Set up save response then refetch response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, count: 1 }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ targets: mockTargets }),
    });

    let saveResult: { success: boolean; error?: string } | undefined;
    await act(async () => {
      saveResult = await result.current.saveTargets([
        { domain_id: DOMAIN_UUID, metric_name: 'item_count', target_value: 10 },
      ]);
    });

    expect(saveResult?.success).toBe(true);

    // Verify PUT was called
    expect(mockFetch).toHaveBeenCalledWith('/api/coverage/targets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targets: [{ domain_id: DOMAIN_UUID, metric_name: 'item_count', target_value: 10 }],
      }),
    });

    // After save, targets should be refetched
    await waitFor(() => {
      expect(result.current.targets).toEqual(mockTargets);
    });
  });

  it('saveTargets returns error on failure', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ targets: [] }),
    });

    const { result } = renderHook(() => useCoverageTargets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Save fails
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' }),
    });

    let saveResult: { success: boolean; error?: string } | undefined;
    await act(async () => {
      saveResult = await result.current.saveTargets([
        { domain_id: DOMAIN_UUID, metric_name: 'item_count', target_value: 10 },
      ]);
    });

    expect(saveResult?.success).toBe(false);
    expect(saveResult?.error).toBe('Forbidden');
  });

  it('refetch re-fetches targets', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ targets: [] }),
    });

    const { result } = renderHook(() => useCoverageTargets());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Refetch with new data
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ targets: mockTargets }),
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.targets).toEqual(mockTargets);
  });
});
