/**
 * useContentSelection — shared selection state hook tests.
 *
 * Covers: toggleSelect, toggleSelectAll, clearSelection, isAllSelected,
 * and automatic reset when resetDeps change.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useContentSelection } from '@/lib/content-browsing/use-content-selection';

describe('useContentSelection', () => {
  // -----------------------------------------------------------------------
  // toggleSelect
  // -----------------------------------------------------------------------

  it('adds an id to the selection', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelect('a'));
    expect(result.current.selectedIds.has('a')).toBe(true);
    expect(result.current.selectedIds.size).toBe(1);
  });

  it('removes an already-selected id', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelect('a'));
    act(() => result.current.toggleSelect('a'));
    expect(result.current.selectedIds.has('a')).toBe(false);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('supports multiple toggles producing a multi-item set', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => {
      result.current.toggleSelect('a');
      result.current.toggleSelect('b');
      result.current.toggleSelect('c');
    });
    expect(result.current.selectedIds.size).toBe(3);
  });

  // -----------------------------------------------------------------------
  // toggleSelectAll
  // -----------------------------------------------------------------------

  it('selects all when none are selected', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelectAll(['a', 'b', 'c']));
    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.selectedIds.has('a')).toBe(true);
    expect(result.current.selectedIds.has('b')).toBe(true);
    expect(result.current.selectedIds.has('c')).toBe(true);
  });

  it('deselects all when all are already selected', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelectAll(['a', 'b']));
    act(() => result.current.toggleSelectAll(['a', 'b']));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('selects all when only some are selected (partial -> full)', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelect('a'));
    // Only 1 selected but allIds has 3 => should select all
    act(() => result.current.toggleSelectAll(['a', 'b', 'c']));
    expect(result.current.selectedIds.size).toBe(3);
  });

  it('does nothing for empty allIds array', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelectAll([]));
    expect(result.current.selectedIds.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // clearSelection
  // -----------------------------------------------------------------------

  it('clears all selected items', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => {
      result.current.toggleSelect('a');
      result.current.toggleSelect('b');
    });
    expect(result.current.selectedIds.size).toBe(2);
    act(() => result.current.clearSelection());
    expect(result.current.selectedIds.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // isAllSelected
  // -----------------------------------------------------------------------

  it('returns true when selection size matches totalCount', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelectAll(['a', 'b']));
    expect(result.current.isAllSelected(2)).toBe(true);
  });

  it('returns false when selection size does not match', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelect('a'));
    expect(result.current.isAllSelected(3)).toBe(false);
  });

  it('returns false for totalCount 0 even with no selections', () => {
    const { result } = renderHook(() => useContentSelection([]));
    expect(result.current.isAllSelected(0)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // reset on deps change
  // -----------------------------------------------------------------------

  it('clears selection when resetDeps change', () => {
    let dep = 'domain-a';
    const { result, rerender } = renderHook(() => useContentSelection([dep]));
    act(() => result.current.toggleSelect('x'));
    expect(result.current.selectedIds.size).toBe(1);

    dep = 'domain-b';
    rerender();
    expect(result.current.selectedIds.size).toBe(0);
  });
});
