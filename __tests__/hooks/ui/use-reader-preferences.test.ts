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

  it('toggleReader closes when open', () => {
    localStorageStore['kb-reader-preferences'] = JSON.stringify({
      readerOpen: true,
    });

    const { result } = renderHook(() => useReaderPreferences());

    act(() => {
      result.current.toggleReader();
    });

    expect(result.current.readerOpen).toBe(false);
  });

  // -------------------------------------------------------------------------
  // P1-7: floating reader removed — no detach/floating state
  // -------------------------------------------------------------------------

  it('does not expose floating/detach state (P1-7)', () => {
    const { result } = renderHook(() => useReaderPreferences());

    // These properties should no longer exist on the return value
    const returned = result.current as Record<string, unknown>;
    expect(returned.isDetached).toBeUndefined();
    expect(returned.detachedPosition).toBeUndefined();
    expect(returned.detachedSize).toBeUndefined();
    expect(returned.toggleDetached).toBeUndefined();
    expect(returned.setDetachedPosition).toBeUndefined();
    expect(returned.setDetachedSize).toBeUndefined();
    expect(returned.setIsDetached).toBeUndefined();
  });
});
