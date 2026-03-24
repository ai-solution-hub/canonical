/**
 * useQuickReview Hook Tests
 *
 * Tests the lightweight review action hook for verify/flag actions
 * from Browse and other pages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock sonner
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { useQuickReview } from '@/hooks/use-quick-review';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk() {
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
}

function mockFetchFail() {
  global.fetch = vi.fn().mockResolvedValue({ ok: false });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useQuickReview', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchOk();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // --- quickVerify ---

  it('quickVerify calls API with correct payload', async () => {
    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickVerify('item-1', 'Test Item');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: 'item-1', action: 'verify' }),
    });
  });

  it('quickVerify calls onOptimisticUpdate before API call', async () => {
    const onOptimisticUpdate = vi.fn();
    const callOrder: string[] = [];

    onOptimisticUpdate.mockImplementation(() => {
      callOrder.push('optimistic');
    });
    global.fetch = vi.fn().mockImplementation(() => {
      callOrder.push('fetch');
      return Promise.resolve({ ok: true });
    });

    const { result } = renderHook(() =>
      useQuickReview({ onOptimisticUpdate }),
    );

    await act(async () => {
      await result.current.quickVerify('item-1', 'Test Item');
    });

    expect(onOptimisticUpdate).toHaveBeenCalledWith('item-1', {
      verified_at: expect.any(String),
    });
    expect(callOrder[0]).toBe('optimistic');
    expect(callOrder[1]).toBe('fetch');
  });

  it('quickVerify shows success toast with undo', async () => {
    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickVerify('item-1', 'Test Article');
    });

    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Verified: Test Article',
      expect.objectContaining({
        duration: 5000,
        action: expect.objectContaining({ label: 'Undo' }),
      }),
    );
  });

  it('quickVerify rolls back on API error', async () => {
    mockFetchFail();
    const onOptimisticUpdate = vi.fn();

    const { result } = renderHook(() =>
      useQuickReview({ onOptimisticUpdate }),
    );

    await act(async () => {
      await result.current.quickVerify('item-1', 'Test Item');
    });

    // First call: optimistic update with verified_at
    expect(onOptimisticUpdate).toHaveBeenNthCalledWith(1, 'item-1', {
      verified_at: expect.any(String),
    });
    // Second call: rollback with verified_at: null
    expect(onOptimisticUpdate).toHaveBeenNthCalledWith(2, 'item-1', {
      verified_at: null,
    });
  });

  it('quickVerify shows error toast on API failure', async () => {
    mockFetchFail();

    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickVerify('item-1', 'Test Item');
    });

    expect(mockToastError).toHaveBeenCalledWith(
      'Action failed. Check your connection and try again.',
    );
  });

  // --- quickUnverify ---

  it('quickUnverify calls API with action: unverify', async () => {
    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickUnverify('item-1', 'Test Item');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: 'item-1', action: 'unverify' }),
    });
  });

  // --- quickFlag ---

  it('quickFlag calls API with action: flag and optional flag_details', async () => {
    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickFlag('item-1', 'Test Item', 'Outdated info');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_id: 'item-1',
        action: 'flag',
        flag_details: 'Outdated info',
      }),
    });
  });

  it('quickFlag calls optimistic update with verified_at: null and hasQualityFlag: true', async () => {
    const onOptimisticUpdate = vi.fn();

    const { result } = renderHook(() =>
      useQuickReview({ onOptimisticUpdate }),
    );

    await act(async () => {
      await result.current.quickFlag('item-1', 'Test Item');
    });

    expect(onOptimisticUpdate).toHaveBeenCalledWith('item-1', {
      verified_at: null,
      hasQualityFlag: true,
    });
  });

  it('quickFlag rolls back on API error', async () => {
    mockFetchFail();
    const onOptimisticUpdate = vi.fn();

    const { result } = renderHook(() =>
      useQuickReview({ onOptimisticUpdate }),
    );

    await act(async () => {
      await result.current.quickFlag('item-1', 'Test Item');
    });

    // First call: optimistic
    expect(onOptimisticUpdate).toHaveBeenNthCalledWith(1, 'item-1', {
      verified_at: null,
      hasQualityFlag: true,
    });
    // Second call: rollback
    expect(onOptimisticUpdate).toHaveBeenNthCalledWith(2, 'item-1', {
      hasQualityFlag: false,
    });
  });

  // --- quickUnflag ---

  it('quickUnflag calls API with action: unflag', async () => {
    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickUnflag('item-1', 'Test Item');
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: 'item-1', action: 'unflag' }),
    });
  });

  // --- Pending state ---

  it('isPending returns true while action is in flight', async () => {
    let resolvePromise!: () => void;
    global.fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () => resolve({ ok: true });
      }),
    );

    const { result } = renderHook(() => useQuickReview());

    // Start action without awaiting
    let verifyPromise: Promise<void>;
    act(() => {
      verifyPromise = result.current.quickVerify('item-1', 'Test Item');
    });

    // Should be pending
    expect(result.current.isPending('item-1')).toBe(true);

    // Resolve
    await act(async () => {
      resolvePromise();
      await verifyPromise!;
    });

    expect(result.current.isPending('item-1')).toBe(false);
  });

  it('isPending returns false after action completes', async () => {
    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickVerify('item-1', 'Test Item');
    });

    expect(result.current.isPending('item-1')).toBe(false);
  });

  it('multiple items can be pending simultaneously', async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    let callCount = 0;

    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return new Promise((resolve) => {
          resolveFirst = () => resolve({ ok: true });
        });
      }
      return new Promise((resolve) => {
        resolveSecond = () => resolve({ ok: true });
      });
    });

    const { result } = renderHook(() => useQuickReview());

    let p1: Promise<void>;
    let p2: Promise<void>;
    act(() => {
      p1 = result.current.quickVerify('item-1', 'Item 1');
      p2 = result.current.quickFlag('item-2', 'Item 2');
    });

    expect(result.current.isPending('item-1')).toBe(true);
    expect(result.current.isPending('item-2')).toBe(true);

    await act(async () => {
      resolveFirst();
      await p1!;
    });

    expect(result.current.isPending('item-1')).toBe(false);
    expect(result.current.isPending('item-2')).toBe(true);

    await act(async () => {
      resolveSecond();
      await p2!;
    });

    expect(result.current.isPending('item-2')).toBe(false);
  });

  it('undo on verify toast calls quickUnverify', async () => {
    const { result } = renderHook(() => useQuickReview());

    await act(async () => {
      await result.current.quickVerify('item-1', 'Test Article');
    });

    // Extract the undo callback from the toast call
    const toastArgs = mockToastSuccess.mock.calls[0];
    const undoAction = toastArgs[1]?.action;
    expect(undoAction).toBeDefined();
    expect(undoAction.label).toBe('Undo');

    // Clear fetch mock and trigger undo
    (global.fetch as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await undoAction.onClick();
    });

    // Should call unverify
    expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: 'item-1', action: 'unverify' }),
    });
  });
});
