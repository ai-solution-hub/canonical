import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Setup — localStorage + matchMedia + documentElement stubs
// ---------------------------------------------------------------------------

let localStorageStore: Record<string, string>;

const mockMatchMedia = vi.fn((query: string) => ({
  matches: false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  onchange: null,
  dispatchEvent: vi.fn(),
}));

beforeEach(() => {
  localStorageStore = {};
  vi.clearAllMocks();

  vi.stubGlobal('matchMedia', mockMatchMedia);

  // Mock localStorage
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageStore[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageStore[key];
    }),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Clean up any DOM attributes set during tests
  document.documentElement.removeAttribute('data-a11y-mode');
  document.documentElement.removeAttribute('data-a11y-font');
});

import { useAccessibility } from '@/hooks/ui/use-accessibility';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAccessibility', () => {
  it('returns null mode and font by default', () => {
    const { result } = renderHook(() => useAccessibility());

    expect(result.current.a11yMode).toBeNull();
    expect(result.current.a11yFont).toBeNull();
    expect(result.current.hasNonDefaultSettings).toBe(false);
  });

  it('loads mode from localStorage on initialisation', () => {
    localStorageStore['kh-a11y-mode'] = 'dyslexia';

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.a11yMode).toBe('dyslexia');
    expect(result.current.hasNonDefaultSettings).toBe(true);
  });

  it('loads font from localStorage on initialisation', () => {
    localStorageStore['kh-a11y-font'] = 'opendyslexic';

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.a11yFont).toBe('opendyslexic');
  });

  it('setA11yMode sets mode, persists to localStorage, and sets DOM attribute', () => {
    const { result } = renderHook(() => useAccessibility());

    act(() => {
      result.current.setA11yMode('large-text');
    });

    expect(result.current.a11yMode).toBe('large-text');
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'kh-a11y-mode',
      'large-text',
    );
    expect(document.documentElement.getAttribute('data-a11y-mode')).toBe(
      'large-text',
    );
  });

  it('clearing mode removes localStorage, DOM attribute, and also clears font', () => {
    localStorageStore['kh-a11y-mode'] = 'dyslexia';
    localStorageStore['kh-a11y-font'] = 'opendyslexic';

    const { result } = renderHook(() => useAccessibility());

    act(() => {
      result.current.setA11yMode(null);
    });

    expect(result.current.a11yMode).toBeNull();
    expect(result.current.a11yFont).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith('kh-a11y-mode');
    expect(localStorage.removeItem).toHaveBeenCalledWith('kh-a11y-font');
    expect(document.documentElement.getAttribute('data-a11y-mode')).toBeNull();
    expect(document.documentElement.getAttribute('data-a11y-font')).toBeNull();
  });

  it('setA11yFont sets font, persists to localStorage, and sets DOM attribute', () => {
    const { result } = renderHook(() => useAccessibility());

    act(() => {
      result.current.setA11yFont('atkinson');
    });

    expect(result.current.a11yFont).toBe('atkinson');
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'kh-a11y-font',
      'atkinson',
    );
    expect(document.documentElement.getAttribute('data-a11y-font')).toBe(
      'atkinson',
    );
  });

  it('clearing font removes localStorage and DOM attribute', () => {
    const { result } = renderHook(() => useAccessibility());

    act(() => {
      result.current.setA11yFont('atkinson');
    });
    act(() => {
      result.current.setA11yFont(null);
    });

    expect(result.current.a11yFont).toBeNull();
    expect(localStorage.removeItem).toHaveBeenCalledWith('kh-a11y-font');
    expect(document.documentElement.getAttribute('data-a11y-font')).toBeNull();
  });

  it('detects system high-contrast preference on initialisation', () => {
    mockMatchMedia.mockImplementation((query: string) => ({
      matches: query === '(prefers-contrast: more)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useAccessibility());

    expect(result.current.a11yMode).toBe('high-contrast');
  });

  it('responds to system contrast media query change event', () => {
    let changeHandler: ((e: { matches: boolean }) => void) | null = null;

    mockMatchMedia.mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(
        (_event: string, handler: (e: { matches: boolean }) => void) => {
          if (query === '(prefers-contrast: more)') {
            changeHandler = handler;
          }
        },
      ),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useAccessibility());
    expect(result.current.a11yMode).toBeNull();

    // Simulate system contrast change
    act(() => {
      changeHandler?.({ matches: true });
    });

    expect(result.current.a11yMode).toBe('high-contrast');
  });
});
