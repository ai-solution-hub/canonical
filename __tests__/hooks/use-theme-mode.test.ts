import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockSetTheme } = vi.hoisted(() => ({
  mockSetTheme: vi.fn(),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({
    theme: 'light',
    setTheme: mockSetTheme,
    resolvedTheme: 'light',
  }),
}));

import { useThemeMode } from '@/hooks/ui/use-theme-mode';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useThemeMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes through theme and resolvedTheme from next-themes', () => {
    const { result } = renderHook(() => useThemeMode());

    expect(result.current.theme).toBe('light');
    expect(result.current.resolvedTheme).toBe('light');
  });

  it('calls setTheme from next-themes when view transitions are unavailable', () => {
    // Ensure startViewTransition is not available
    const original = document.startViewTransition;
    // @ts-expect-error — removing for test
    delete document.startViewTransition;

    const { result } = renderHook(() => useThemeMode());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(mockSetTheme).toHaveBeenCalledWith('dark');

    // Restore
    if (original) {
      document.startViewTransition = original;
    }
  });

  it('uses view transition API when available', () => {
    const mockStartViewTransition = vi.fn((cb: () => void) => cb());
    document.startViewTransition = mockStartViewTransition;

    // Also need matchMedia to return false for reduced motion
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        media: '',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    );

    const { result } = renderHook(() => useThemeMode());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(mockStartViewTransition).toHaveBeenCalled();
    expect(mockSetTheme).toHaveBeenCalledWith('dark');

    // @ts-expect-error — cleanup
    delete document.startViewTransition;
    vi.unstubAllGlobals();
  });

  it('skips view transition when prefers-reduced-motion is enabled', () => {
    const mockStartViewTransition = vi.fn((cb: () => void) => cb());
    document.startViewTransition = mockStartViewTransition;

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true, // prefers-reduced-motion: reduce
        media: '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        onchange: null,
        dispatchEvent: vi.fn(),
      })),
    );

    const { result } = renderHook(() => useThemeMode());

    act(() => {
      result.current.setTheme('dark');
    });

    expect(mockStartViewTransition).not.toHaveBeenCalled();
    expect(mockSetTheme).toHaveBeenCalledWith('dark');

    // @ts-expect-error — cleanup
    delete document.startViewTransition;
    vi.unstubAllGlobals();
  });
});
