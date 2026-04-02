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
});

import { useReaderPreferences } from '@/hooks/ui/use-reader-preferences';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReaderPreferences', () => {
  // -------------------------------------------------------------------------
  // Defaults
  // -------------------------------------------------------------------------

  it('returns default preferences when localStorage is empty', () => {
    const { result } = renderHook(() => useReaderPreferences());

    expect(result.current.fontSize).toBe('medium');
    expect(result.current.maxWidth).toBe('medium');
    expect(result.current.panelLayout).toEqual({ detail: 55, reader: 45 });
    expect(result.current.readerOpen).toBe(false);
    expect(result.current.isDetached).toBe(false);
    expect(result.current.detachedPosition).toBeNull();
    expect(result.current.detachedSize).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Load from localStorage
  // -------------------------------------------------------------------------

  it('loads saved preferences from localStorage', () => {
    localStorageStore['kb-reader-preferences'] = JSON.stringify({
      fontSize: 'large',
      maxWidth: 'wide',
      panelLayout: { detail: 40, reader: 60 },
      readerOpen: true,
      isDetached: false,
      detachedPosition: null,
      detachedSize: null,
    });

    const { result } = renderHook(() => useReaderPreferences());

    expect(result.current.fontSize).toBe('large');
    expect(result.current.maxWidth).toBe('wide');
    expect(result.current.panelLayout).toEqual({ detail: 40, reader: 60 });
    expect(result.current.readerOpen).toBe(true);
  });

  it('falls back to defaults for invalid JSON in localStorage', () => {
    localStorageStore['kb-reader-preferences'] = 'not-valid-json';

    const { result } = renderHook(() => useReaderPreferences());

    expect(result.current.fontSize).toBe('medium');
    expect(result.current.maxWidth).toBe('medium');
  });

  it('validates size constraints — rejects size with width < 400', () => {
    localStorageStore['kb-reader-preferences'] = JSON.stringify({
      detachedSize: { width: 300, height: 500 },
    });

    const { result } = renderHook(() => useReaderPreferences());

    expect(result.current.detachedSize).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Setters
  // -------------------------------------------------------------------------

  it('setFontSize updates and persists', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.setFontSize('large');
    });

    expect(result.current.fontSize).toBe('large');
    expect(localStorage.setItem).toHaveBeenCalled();
  });

  it('setMaxWidth updates and persists', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.setMaxWidth('narrow');
    });

    expect(result.current.maxWidth).toBe('narrow');
  });

  it('setPanelLayout updates layout', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.setPanelLayout({ detail: 70, reader: 30 });
    });

    expect(result.current.panelLayout).toEqual({ detail: 70, reader: 30 });
  });

  it('setReaderOpen opens reader', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.setReaderOpen(true);
    });

    expect(result.current.readerOpen).toBe(true);
  });

  it('setReaderOpen(false) also un-detaches', () => {
    localStorageStore['kb-reader-preferences'] = JSON.stringify({
      readerOpen: true,
      isDetached: true,
    });

    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.setReaderOpen(false);
    });

    expect(result.current.readerOpen).toBe(false);
    expect(result.current.isDetached).toBe(false);
  });

  // -------------------------------------------------------------------------
  // toggleReader
  // -------------------------------------------------------------------------

  it('toggleReader opens when closed', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.toggleReader();
    });

    expect(result.current.readerOpen).toBe(true);
  });

  it('toggleReader closing also un-detaches', () => {
    localStorageStore['kb-reader-preferences'] = JSON.stringify({
      readerOpen: true,
      isDetached: true,
    });

    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.toggleReader();
    });

    expect(result.current.readerOpen).toBe(false);
    expect(result.current.isDetached).toBe(false);
  });

  // -------------------------------------------------------------------------
  // toggleDetached
  // -------------------------------------------------------------------------

  it('toggleDetached does nothing when reader is closed', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.toggleDetached();
    });

    expect(result.current.isDetached).toBe(false);
  });

  it('toggleDetached toggles when reader is open', () => {
    localStorageStore['kb-reader-preferences'] = JSON.stringify({
      readerOpen: true,
    });

    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.toggleDetached();
    });

    expect(result.current.isDetached).toBe(true);

    act(() => {
      result.current.toggleDetached();
    });

    expect(result.current.isDetached).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Detached position and size
  // -------------------------------------------------------------------------

  it('setDetachedPosition updates position', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.setDetachedPosition({ x: 200, y: 150 });
    });

    expect(result.current.detachedPosition).toEqual({ x: 200, y: 150 });
  });

  it('setDetachedSize updates size', () => {
    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.setDetachedSize({ width: 800, height: 600 });
    });

    expect(result.current.detachedSize).toEqual({ width: 800, height: 600 });
  });

  // -------------------------------------------------------------------------
  // Auto-reattach on small screens
  // -------------------------------------------------------------------------

  it('auto-reattaches when window is resized below 768px', () => {
    localStorageStore['kb-reader-preferences'] = JSON.stringify({
      readerOpen: true,
      isDetached: true,
    });

    // Start with wide screen
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      writable: true,
      configurable: true,
    });

    const { result } = renderHook(() => useReaderPreferences());
    expect(result.current.isDetached).toBe(true);

    // Simulate resize to narrow screen
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        value: 600,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current.isDetached).toBe(false);
  });
});
