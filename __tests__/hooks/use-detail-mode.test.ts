/**
 * useDetailMode Hook Tests
 *
 * Tests reader/editor mode management:
 * - Viewer lock (always reader, setters are no-ops)
 * - Editor toggle between reader and editor modes
 * - localStorage persistence for editors
 * - Convenience flags (isReaderMode, isEditorMode, canToggle)
 */
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

import { useDetailMode } from '@/hooks/ui/use-detail-mode';

// ---------------------------------------------------------------------------
// Tests — Viewer behaviour
// ---------------------------------------------------------------------------

describe('useDetailMode — viewer (canEdit: false)', () => {
  it('defaults to reader mode', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: false }));

    expect(result.current.detailMode).toBe('reader');
    expect(result.current.isReaderMode).toBe(true);
    expect(result.current.isEditorMode).toBe(false);
  });

  it('canToggle is false', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: false }));

    expect(result.current.canToggle).toBe(false);
  });

  it('setDetailMode is a no-op', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: false }));

    act(() => {
      result.current.setDetailMode('editor');
    });

    expect(result.current.detailMode).toBe('reader');
    expect(result.current.isReaderMode).toBe(true);
  });

  it('toggleDetailMode is a no-op', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: false }));

    act(() => {
      result.current.toggleDetailMode();
    });

    expect(result.current.detailMode).toBe('reader');
  });

  it('ignores localStorage value when canEdit is false', () => {
    localStorageStore['kh-detail-mode'] = 'editor';

    const { result } = renderHook(() => useDetailMode({ canEdit: false }));

    expect(result.current.detailMode).toBe('reader');
    expect(result.current.isEditorMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Editor behaviour
// ---------------------------------------------------------------------------

describe('useDetailMode — editor (canEdit: true)', () => {
  it('defaults to editor mode', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    expect(result.current.detailMode).toBe('editor');
    expect(result.current.isEditorMode).toBe(true);
    expect(result.current.isReaderMode).toBe(false);
  });

  it('canToggle is true', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    expect(result.current.canToggle).toBe(true);
  });

  it('setDetailMode switches to reader', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    act(() => {
      result.current.setDetailMode('reader');
    });

    expect(result.current.detailMode).toBe('reader');
    expect(result.current.isReaderMode).toBe(true);
    expect(result.current.isEditorMode).toBe(false);
  });

  it('toggleDetailMode toggles between modes', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    // editor -> reader
    act(() => {
      result.current.toggleDetailMode();
    });
    expect(result.current.detailMode).toBe('reader');

    // reader -> editor
    act(() => {
      result.current.toggleDetailMode();
    });
    expect(result.current.detailMode).toBe('editor');
  });

  it('persists mode to localStorage on setDetailMode', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    act(() => {
      result.current.setDetailMode('reader');
    });

    expect(localStorage.setItem).toHaveBeenCalledWith('kh-detail-mode', 'reader');
  });

  it('persists mode to localStorage on toggleDetailMode', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    act(() => {
      result.current.toggleDetailMode();
    });

    expect(localStorage.setItem).toHaveBeenCalledWith('kh-detail-mode', 'reader');
  });

  it('loads stored reader preference from localStorage', () => {
    localStorageStore['kh-detail-mode'] = 'reader';

    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    expect(result.current.detailMode).toBe('reader');
    expect(result.current.isReaderMode).toBe(true);
  });

  it('loads stored editor preference from localStorage', () => {
    localStorageStore['kh-detail-mode'] = 'editor';

    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    expect(result.current.detailMode).toBe('editor');
  });

  it('falls back to editor for invalid stored value', () => {
    localStorageStore['kh-detail-mode'] = 'invalid-value';

    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    expect(result.current.detailMode).toBe('editor');
  });

  it('falls back to editor when localStorage is empty', () => {
    const { result } = renderHook(() => useDetailMode({ canEdit: true }));

    expect(result.current.detailMode).toBe('editor');
  });
});
