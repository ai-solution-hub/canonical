import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Setup — localStorage stub
// ---------------------------------------------------------------------------

let localStorageStore: Record<string, string>;

beforeEach(() => {
  localStorageStore = {};
  vi.clearAllMocks();

  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStorageStore[key] = value; }),
    removeItem: vi.fn((key: string) => { delete localStorageStore[key]; }),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

import { useViewMode } from '@/hooks/ui/use-view-mode';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useViewMode', () => {
  it('defaults to grid mode', () => {
    const { result } = renderHook(() => useViewMode('test-key'));

    expect(result.current.viewMode).toBe('grid');
  });

  it('accepts a custom default mode', () => {
    const { result } = renderHook(() => useViewMode('test-key', 'list'));

    expect(result.current.viewMode).toBe('list');
  });

  it('loads stored value from localStorage', () => {
    localStorageStore['test-key'] = 'list';

    const { result } = renderHook(() => useViewMode('test-key'));

    expect(result.current.viewMode).toBe('list');
  });

  it('falls back to default for invalid stored value', () => {
    localStorageStore['test-key'] = 'invalid';

    const { result } = renderHook(() => useViewMode('test-key'));

    expect(result.current.viewMode).toBe('grid');
  });

  it('setViewMode updates mode and persists to localStorage', () => {
    const { result } = renderHook(() => useViewMode('test-key'));

    act(() => {
      result.current.setViewMode('list');
    });

    expect(result.current.viewMode).toBe('list');
    expect(localStorage.setItem).toHaveBeenCalledWith('test-key', 'list');
  });
});
