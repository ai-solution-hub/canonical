import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockToast, mockValidateEditableField } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  mockValidateEditableField: vi.fn(() => true),
}));

vi.mock('sonner', () => ({ toast: mockToast }));
vi.mock('@/lib/validation', () => ({
  validateEditableField: (...args: unknown[]) => mockValidateEditableField(...args),
}));

let mockFetch: ReturnType<typeof vi.fn>;

import { useInlineFieldEdit } from '@/hooks/use-inline-field-edit';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useInlineFieldEdit', () => {
  const onItemUpdate = vi.fn((updater: (prev: Record<string, unknown>) => Record<string, unknown>) => {
    return updater({ suggested_title: 'Old Title' });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateEditableField.mockReturnValue(true);
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // startEdit / cancelEdit
  // -------------------------------------------------------------------------

  it('starts editing a field with current value', () => {
    const { result } = renderHook(() =>
      useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }), {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    act(() => {
      result.current.startEdit('suggested_title', 'Current Title');
    });

    expect(result.current.editingField).toBe('suggested_title');
    expect(result.current.editValue).toBe('Current Title');
  });

  it('converts null to empty string when starting edit', () => {
    const { result } = renderHook(() =>
      useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }), {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    act(() => {
      result.current.startEdit('suggested_title', null);
    });

    expect(result.current.editValue).toBe('');
  });

  it('cancels editing and resets state', () => {
    const { result } = renderHook(() =>
      useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }), {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    act(() => {
      result.current.startEdit('suggested_title', 'Value');
    });
    act(() => {
      result.current.cancelEdit();
    });

    expect(result.current.editingField).toBeNull();
    expect(result.current.editValue).toBe('');
  });

  // -------------------------------------------------------------------------
  // saveEdit — success
  // -------------------------------------------------------------------------

  it('saves edit with optimistic update and calls fetch', async () => {
    const { result } = renderHook(() =>
      useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }), {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    await act(async () => {
      await result.current.saveEdit('suggested_title', 'New Title');
    });

    // Optimistic update applied
    expect(onItemUpdate).toHaveBeenCalled();
    // Fetch called
    expect(mockFetch).toHaveBeenCalledWith('/api/items/item-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'suggested_title', value: 'New Title' }),
    });
    // Editing cleared
    expect(result.current.editingField).toBeNull();
    expect(result.current.saveSuccess).toBe('suggested_title');
  });

  // -------------------------------------------------------------------------
  // saveEdit — validation rejection
  // -------------------------------------------------------------------------

  it('rejects save for non-editable fields', async () => {
    mockValidateEditableField.mockReturnValue(false);

    const { result } = renderHook(() =>
      useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }), {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    await act(async () => {
      await result.current.saveEdit('id', 'bad-value');
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith('This field cannot be edited');
  });

  // -------------------------------------------------------------------------
  // saveEdit — rollback on failure
  // -------------------------------------------------------------------------

  it('rolls back optimistic update on fetch failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Update failed' }),
    });

    const { result } = renderHook(() =>
      useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }), {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    await act(async () => {
      await result.current.saveEdit('suggested_title', 'New Title');
    });

    // onItemUpdate called twice: optimistic + rollback
    expect(onItemUpdate).toHaveBeenCalledTimes(2);
    expect(mockToast.error).toHaveBeenCalledWith('Failed to save — please try again');
    expect(result.current.saveAnnouncement).toBe('Save failed');
  });

  // -------------------------------------------------------------------------
  // setEditValue
  // -------------------------------------------------------------------------

  it('allows setting edit value directly', () => {
    const { result } = renderHook(() =>
      useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }), {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    act(() => {
      result.current.setEditValue('manual value');
    });

    expect(result.current.editValue).toBe('manual value');
  });
});
