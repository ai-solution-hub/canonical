import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContentLibraryDrawer } from '@/hooks/use-content-library-drawer';

describe('useContentLibraryDrawer', () => {
  it('starts closed with no question text', () => {
    const { result } = renderHook(() => useContentLibraryDrawer());

    expect(result.current.isOpen).toBe(false);
    expect(result.current.questionText).toBeUndefined();
  });

  it('open() opens the drawer', () => {
    const { result } = renderHook(() => useContentLibraryDrawer());

    act(() => {
      result.current.open();
    });

    expect(result.current.isOpen).toBe(true);
  });

  it('open() sets question text', () => {
    const { result } = renderHook(() => useContentLibraryDrawer());

    act(() => {
      result.current.open('What is your approach?');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.questionText).toBe('What is your approach?');
  });

  it('close() closes the drawer', () => {
    const { result } = renderHook(() => useContentLibraryDrawer());

    act(() => {
      result.current.open();
    });
    act(() => {
      result.current.close();
    });

    expect(result.current.isOpen).toBe(false);
  });

  it('toggle() opens when closed and sets question text', () => {
    const { result } = renderHook(() => useContentLibraryDrawer());

    act(() => {
      result.current.toggle('Describe your methodology');
    });

    expect(result.current.isOpen).toBe(true);
    expect(result.current.questionText).toBe('Describe your methodology');
  });

  it('toggle() closes when open', () => {
    const { result } = renderHook(() => useContentLibraryDrawer());

    act(() => {
      result.current.open();
    });
    act(() => {
      result.current.toggle();
    });

    expect(result.current.isOpen).toBe(false);
  });
});
