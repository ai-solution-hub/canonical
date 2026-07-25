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
  // setAllSelected
  //
  // Direction is an explicit argument, never inferred from the current
  // selection size. {128.19}: the previous size-derived form compared
  // `prev.size === allIds.length` to decide select-vs-deselect, so any change
  // in the visible row count between two clicks silently inverted the second
  // one — "deselect all" re-selected everything.
  // -----------------------------------------------------------------------

  it('selects every visible item when asked to select', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.setAllSelected(['a', 'b', 'c'], true));
    expect(result.current.selectedIds.size).toBe(3);
    expect(result.current.selectedIds.has('a')).toBe(true);
    expect(result.current.selectedIds.has('b')).toBe(true);
    expect(result.current.selectedIds.has('c')).toBe(true);
  });

  it('empties the selection when asked to deselect', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.setAllSelected(['a', 'b'], true));
    act(() => result.current.setAllSelected(['a', 'b'], false));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('promotes a partial selection to a full one when asked to select', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.toggleSelect('a'));
    act(() => result.current.setAllSelected(['a', 'b', 'c'], true));
    expect(result.current.selectedIds.size).toBe(3);
  });

  it('still deselects when the visible row count grew since selecting', () => {
    // The {128.19} regression: everything visible was selected, then a
    // background refetch (or retained placeholder data) revealed a fourth
    // row before the user clicked again. Deselect must still deselect.
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.setAllSelected(['a', 'b', 'c'], true));
    act(() => result.current.setAllSelected(['a', 'b', 'c', 'd'], false));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('still deselects when the visible row count shrank since selecting', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.setAllSelected(['a', 'b', 'c'], true));
    act(() => result.current.setAllSelected(['a', 'b'], false));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it('leaves the selection empty when there is nothing to select', () => {
    const { result } = renderHook(() => useContentSelection([]));
    act(() => result.current.setAllSelected([], true));
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
    act(() => result.current.setAllSelected(['a', 'b'], true));
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
