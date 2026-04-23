/**
 * useContentBulkRunner — shared sequential bulk operation runner tests.
 *
 * Covers: sequential execution, progress updates, error counting,
 * query invalidation, toast behaviour, and itemLookup support.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContentBulkRunner } from '@/lib/content-browsing/use-content-bulk-runner';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

describe('useContentBulkRunner', () => {
  const queryKey = ['content-items'] as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs an operation for each id and returns success count', async () => {
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    const operation = vi.fn().mockResolvedValue(true);
    let successCount: number | undefined;

    await act(async () => {
      successCount = await result.current.runBulkOperation(
        'Testing',
        ['a', 'b', 'c'],
        operation,
      );
    });

    expect(successCount).toBe(3);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(operation).toHaveBeenCalledWith('a', undefined);
    expect(operation).toHaveBeenCalledWith('b', undefined);
    expect(operation).toHaveBeenCalledWith('c', undefined);
  });

  it('counts failed operations and shows error toast', async () => {
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    const operation = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    let successCount: number | undefined;
    await act(async () => {
      successCount = await result.current.runBulkOperation(
        'Verifying',
        ['a', 'b', 'c'],
        operation,
      );
    });

    expect(successCount).toBe(2);
    expect(mockToast.error).toHaveBeenCalledWith(
      '1 item failed during verifying',
    );
  });

  it('handles thrown errors in operations', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    const operation = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('network fail'));

    await act(async () => {
      await result.current.runBulkOperation('Deleting', ['a', 'b'], operation);
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      '1 item failed during deleting',
    );
    consoleSpy.mockRestore();
  });

  it('invalidates queries after completion', async () => {
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    await act(async () => {
      await result.current.runBulkOperation(
        'Testing',
        ['a'],
        async () => true,
      );
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ['content-items'],
    });
  });

  it('resets bulkOperating to false after completion', async () => {
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    expect(result.current.bulkOperating).toBe(false);

    await act(async () => {
      await result.current.runBulkOperation(
        'Testing',
        ['a'],
        async () => true,
      );
    });

    // After completion, bulkOperating should be reset
    expect(result.current.bulkOperating).toBe(false);
  });

  it('resets progress after completion', async () => {
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    await act(async () => {
      await result.current.runBulkOperation(
        'Testing',
        ['a', 'b'],
        async () => true,
      );
    });

    expect(result.current.bulkProgress).toEqual({
      current: 0,
      total: 0,
      label: '',
    });
  });

  it('does not show error toast when all operations succeed', async () => {
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    await act(async () => {
      await result.current.runBulkOperation(
        'Testing',
        ['a', 'b'],
        async () => true,
      );
    });

    expect(mockToast.error).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // itemLookup support (library tag-merge path)
  // -----------------------------------------------------------------------

  it('passes resolved item from itemLookup to operation handler', async () => {
    interface TestItem {
      id: string;
      tags: string[];
    }

    const { result } = renderHook(
      () => useContentBulkRunner<TestItem>(queryKey),
    );

    const items: TestItem[] = [
      { id: 'a', tags: ['tag1'] },
      { id: 'b', tags: ['tag2'] },
    ];

    const lookup = (id: string) => items.find((i) => i.id === id);
    const operation = vi.fn().mockResolvedValue(true);

    await act(async () => {
      await result.current.runBulkOperation(
        'Tagging',
        ['a', 'b'],
        operation,
        lookup,
      );
    });

    expect(operation).toHaveBeenCalledWith('a', { id: 'a', tags: ['tag1'] });
    expect(operation).toHaveBeenCalledWith('b', { id: 'b', tags: ['tag2'] });
  });

  it('skips items not found by itemLookup', async () => {
    const { result } = renderHook(
      () => useContentBulkRunner<{ id: string }>(queryKey),
    );

    const lookup = (_id: string) => undefined;
    const operation = vi.fn().mockResolvedValue(true);

    let count: number | undefined;
    await act(async () => {
      count = await result.current.runBulkOperation(
        'Tagging',
        ['missing'],
        operation,
        lookup,
      );
    });

    expect(operation).not.toHaveBeenCalled();
    expect(count).toBe(0);
  });

  it('pluralises error toast for multiple failures', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(
      () => useContentBulkRunner(queryKey),
    );

    await act(async () => {
      await result.current.runBulkOperation(
        'Deleting',
        ['a', 'b', 'c'],
        async () => false,
      );
    });

    expect(mockToast.error).toHaveBeenCalledWith(
      '3 items failed during deleting',
    );
    consoleSpy.mockRestore();
  });
});
