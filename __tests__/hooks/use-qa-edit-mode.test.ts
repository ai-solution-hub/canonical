import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({ toast: mockToast }));

let mockFetch: ReturnType<typeof vi.fn>;

import { useQAEditMode } from '@/hooks/use-qa-edit-mode';
import type { UseQAEditModeParams } from '@/hooks/use-qa-edit-mode';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultParams(overrides: Partial<UseQAEditModeParams> = {}): UseQAEditModeParams {
  return {
    itemId: 'item-1',
    title: 'Original Title',
    answerStandard: 'Standard answer',
    answerAdvanced: 'Advanced answer',
    isQAPair: true,
    onFieldSaved: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useQAEditMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  // Initial state
  // -------------------------------------------------------------------------

  it('returns not editing initially', () => {
    const { result } = renderHook(() => useQAEditMode(defaultParams()));

    expect(result.current.isEditing).toBe(false);
    expect(result.current.editDirty).toBe(false);
    expect(result.current.isSavingTab).toBe(false);
  });

  // -------------------------------------------------------------------------
  // enterEditMode
  // -------------------------------------------------------------------------

  it('enters edit mode with current values', () => {
    const { result } = renderHook(() => useQAEditMode(defaultParams()));

    act(() => {
      result.current.enterEditMode();
    });

    expect(result.current.isEditing).toBe(true);
    expect(result.current.editTitle).toBe('Original Title');
    expect(result.current.editStandard).toBe('Standard answer');
    expect(result.current.editAdvanced).toBe('Advanced answer');
    expect(result.current.editDirty).toBe(false);
  });

  it('handles null answerStandard and answerAdvanced', () => {
    const { result } = renderHook(() =>
      useQAEditMode(defaultParams({ answerStandard: null, answerAdvanced: null })),
    );

    act(() => {
      result.current.enterEditMode();
    });

    expect(result.current.editStandard).toBe('');
    expect(result.current.editAdvanced).toBe('');
  });

  // -------------------------------------------------------------------------
  // cancelEditMode
  // -------------------------------------------------------------------------

  it('cancels edit mode and resets state', () => {
    const { result } = renderHook(() => useQAEditMode(defaultParams()));

    act(() => {
      result.current.enterEditMode();
    });
    expect(result.current.isEditing).toBe(true);

    act(() => {
      result.current.cancelEditMode();
    });
    expect(result.current.isEditing).toBe(false);
    expect(result.current.editDirty).toBe(false);
    expect(result.current.editTitle).toBe('');
  });

  // -------------------------------------------------------------------------
  // handleSaveAll
  // -------------------------------------------------------------------------

  it('saves changed title via PATCH', async () => {
    const onFieldSaved = vi.fn();
    const { result } = renderHook(() =>
      useQAEditMode(defaultParams({ isQAPair: false, onFieldSaved })),
    );

    act(() => {
      result.current.enterEditMode();
    });
    act(() => {
      result.current.setEditTitle('New Title');
    });

    await act(async () => {
      await result.current.handleSaveAll();
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/items/item-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'suggested_title', value: 'New Title' }),
    });
    expect(onFieldSaved).toHaveBeenCalledWith('suggested_title', 'New Title');
    expect(mockToast.success).toHaveBeenCalledWith('Changes saved');
    expect(result.current.isEditing).toBe(false);
    expect(result.current.editDirty).toBe(false);
  });

  it('does not PATCH unchanged title', async () => {
    const { result } = renderHook(() =>
      useQAEditMode(defaultParams({ isQAPair: false })),
    );

    act(() => {
      result.current.enterEditMode();
    });
    // Title remains 'Original Title' — unchanged

    await act(async () => {
      await result.current.handleSaveAll();
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockToast.success).toHaveBeenCalledWith('Changes saved');
  });

  it('saves changed Q&A fields for QA pairs', async () => {
    const onFieldSaved = vi.fn();
    const { result } = renderHook(() =>
      useQAEditMode(defaultParams({ onFieldSaved })),
    );

    act(() => {
      result.current.enterEditMode();
    });
    act(() => {
      result.current.setEditStandard('Updated standard');
      result.current.setEditAdvanced('Updated advanced');
    });

    await act(async () => {
      await result.current.handleSaveAll();
    });

    // Title unchanged, so only 2 calls for standard + advanced
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(onFieldSaved).toHaveBeenCalledWith('answer_standard', 'Updated standard');
    expect(onFieldSaved).toHaveBeenCalledWith('answer_advanced', 'Updated advanced');
  });

  it('does not save Q&A fields when isQAPair is false', async () => {
    const { result } = renderHook(() =>
      useQAEditMode(defaultParams({ isQAPair: false })),
    );

    act(() => {
      result.current.enterEditMode();
    });
    act(() => {
      result.current.setEditStandard('Different');
    });

    await act(async () => {
      await result.current.handleSaveAll();
    });

    // Title unchanged, isQAPair=false, so no fetches
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('shows error toast on save failure', async () => {
    mockFetch.mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useQAEditMode(defaultParams()));

    act(() => {
      result.current.enterEditMode();
    });
    act(() => {
      result.current.setEditTitle('Will Fail');
    });

    await act(async () => {
      await result.current.handleSaveAll();
    });

    expect(mockToast.error).toHaveBeenCalledWith('Failed to save — please try again');
  });

  it('passes null for empty Q&A answer fields', async () => {
    const onFieldSaved = vi.fn();
    const { result } = renderHook(() =>
      useQAEditMode(defaultParams({ onFieldSaved })),
    );

    act(() => {
      result.current.enterEditMode();
    });
    act(() => {
      result.current.setEditStandard('');
    });

    await act(async () => {
      await result.current.handleSaveAll();
    });

    // Standard changed from 'Standard answer' to '' => sends null
    const standardCall = mockFetch.mock.calls.find(
      (call: [string, RequestInit]) => {
        const body = JSON.parse(call[1].body as string);
        return body.field === 'answer_standard';
      },
    );
    expect(standardCall).toBeDefined();
    expect(JSON.parse(standardCall![1].body as string).value).toBeNull();
    expect(onFieldSaved).toHaveBeenCalledWith('answer_standard', null);
  });
});
