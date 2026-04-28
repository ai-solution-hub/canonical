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
  mockValidateEditableField: vi.fn((..._args: unknown[]) => true),
}));

vi.mock('sonner', () => ({ toast: mockToast }));
vi.mock('@/lib/validation', () => ({
  validateEditableField: (...args: unknown[]) =>
    mockValidateEditableField(...args),
}));

let mockFetch: ReturnType<typeof vi.fn>;

import { useInlineFieldEdit } from '@/hooks/use-inline-field-edit';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useInlineFieldEdit', () => {
  const onItemUpdate = vi.fn(
    (updater: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      return updater({ suggested_title: 'Old Title' });
    },
  );

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
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      {
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
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    act(() => {
      result.current.startEdit('suggested_title', null);
    });

    expect(result.current.editValue).toBe('');
  });

  it('cancels editing and resets state', () => {
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      {
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
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      {
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

    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      {
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

    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    await act(async () => {
      await result.current.saveEdit('suggested_title', 'New Title');
    });

    // onItemUpdate called twice: optimistic + rollback
    expect(onItemUpdate).toHaveBeenCalledTimes(2);
    expect(mockToast.error).toHaveBeenCalledWith(
      'Failed to save — please try again',
    );
    expect(result.current.saveAnnouncement).toBe('Save failed');
  });

  // -------------------------------------------------------------------------
  // setEditValue
  // -------------------------------------------------------------------------

  it('allows setting edit value directly', () => {
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      {
        wrapper: createQueryWrapper().Wrapper,
      },
    );

    act(() => {
      result.current.setEditValue('manual value');
    });

    expect(result.current.editValue).toBe('manual value');
  });

  // -------------------------------------------------------------------------
  // S198 §1.5 WP4 — regen-embedding plumbing (M4)
  //
  // Three behaviours under test:
  //   1. Caller `extras.regenerate_embedding` overrides the hook-internal
  //      `regenerateEmbedding` state, regardless of which is set.
  //   2. When `extras` is omitted, the hook falls back to its internal state.
  //   3. The internal state resets to `false` on:
  //        a) successful save (existing behaviour)
  //        b) startEdit (H1 fix — was sticky pre-fix)
  //        c) cancelEdit (H1 fix — was sticky pre-fix)
  // -------------------------------------------------------------------------

  it('honours extras.regenerate_embedding=false even when internal state is true', async () => {
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      { wrapper: createQueryWrapper().Wrapper },
    );

    act(() => {
      result.current.setRegenerateEmbedding(true);
    });

    await act(async () => {
      await result.current.saveEdit('suggested_title', 'New Title', null, {
        regenerate_embedding: false,
      });
    });

    // Explicit extras wins — body MUST NOT contain regenerate_embedding (the
    // hook only forwards the field when `regenFlag` is truthy, see
    // hooks/use-inline-field-edit.ts:108).
    expect(mockFetch).toHaveBeenCalledWith('/api/items/item-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'suggested_title', value: 'New Title' }),
    });
  });

  it('falls back to internal regenerateEmbedding state when extras is omitted', async () => {
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      { wrapper: createQueryWrapper().Wrapper },
    );

    act(() => {
      result.current.setRegenerateEmbedding(true);
    });

    await act(async () => {
      // No 4th arg → hook reads internal state (true).
      await result.current.saveEdit('suggested_title', 'New Title');
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/items/item-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        field: 'suggested_title',
        value: 'New Title',
        regenerate_embedding: true,
      }),
    });
  });

  it('resets regenerateEmbedding to false after a successful save', async () => {
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      { wrapper: createQueryWrapper().Wrapper },
    );

    act(() => {
      result.current.setRegenerateEmbedding(true);
    });
    expect(result.current.regenerateEmbedding).toBe(true);

    await act(async () => {
      await result.current.saveEdit('suggested_title', 'New Title');
    });

    // mutation.onSuccess clears the flag — see hooks/use-inline-field-edit.ts:136.
    expect(result.current.regenerateEmbedding).toBe(false);
  });

  it('resets regenerateEmbedding to false on startEdit (H1 fix)', () => {
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      { wrapper: createQueryWrapper().Wrapper },
    );

    act(() => {
      result.current.setRegenerateEmbedding(true);
    });
    expect(result.current.regenerateEmbedding).toBe(true);

    // Pre-H1 fix this leaked across consumers — confirms the per-edit toggle
    // is wiped when entering a fresh edit on any field.
    act(() => {
      result.current.startEdit('suggested_title', 'Fresh');
    });

    expect(result.current.regenerateEmbedding).toBe(false);
  });

  it('resets regenerateEmbedding to false on cancelEdit (H1 fix)', () => {
    const { result } = renderHook(
      () => useInlineFieldEdit({ itemId: 'item-1', onItemUpdate }),
      { wrapper: createQueryWrapper().Wrapper },
    );

    act(() => {
      result.current.startEdit('suggested_title', 'Initial');
      result.current.setRegenerateEmbedding(true);
    });
    expect(result.current.regenerateEmbedding).toBe(true);

    // Pre-H1 fix the toggle stayed sticky here, silently applying to the next
    // save on a different field via the same shared hook instance.
    act(() => {
      result.current.cancelEdit();
    });

    expect(result.current.regenerateEmbedding).toBe(false);
  });
});
