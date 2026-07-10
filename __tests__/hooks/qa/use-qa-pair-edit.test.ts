/**
 * useQAPairEdit — inline-edit wiring for the `/library/[id]` viewer's
 * `QAAnswerDisplay` (ID-135 {135.22}).
 *
 * Wires the mature-but-orphaned `QAAnswerDisplay` (`components/qa`) to the
 * live-but-previously-zero-caller `PATCH /api/q-a-pairs/[id]` route. Behaviour
 * under test: the `QAAnswerInlineEdit` contract (startEdit/cancelEdit/saveEdit)
 * and the real fetch call shape saveEdit produces — never implementation
 * details of `useMutation` itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createQueryWrapper } from '../../helpers/query-wrapper';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import { useQAPairEdit } from '@/hooks/qa/use-qa-pair-edit';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const PAIR_ID = '33333333-3333-4333-8333-333333333333';

function hookWrapper() {
  const { Wrapper } = createQueryWrapper();
  return { wrapper: Wrapper };
}

describe('useQAPairEdit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it('starts with no field editing', () => {
    const onSaved = vi.fn();
    const { result } = renderHook(
      () => useQAPairEdit(PAIR_ID, onSaved),
      hookWrapper(),
    );

    expect(result.current.editingField).toBeNull();
    expect(result.current.isSaving).toBe(false);
  });

  it('startEdit sets the field and seeds editValue from the current value', () => {
    const { result } = renderHook(
      () => useQAPairEdit(PAIR_ID, vi.fn()),
      hookWrapper(),
    );

    act(() => {
      result.current.startEdit('answer_standard', 'Current answer');
    });

    expect(result.current.editingField).toBe('answer_standard');
    expect(result.current.editValue).toBe('Current answer');
  });

  it('cancelEdit clears the editing field', () => {
    const { result } = renderHook(
      () => useQAPairEdit(PAIR_ID, vi.fn()),
      hookWrapper(),
    );

    act(() => {
      result.current.startEdit('answer_standard', 'x');
    });
    act(() => {
      result.current.cancelEdit();
    });

    expect(result.current.editingField).toBeNull();
  });

  it('saveEdit PATCHes /api/q-a-pairs/:id with the field, value, and a data edit_intent', async () => {
    const updatedPair = {
      id: PAIR_ID,
      answer_standard: 'New answer',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ q_a_pair: updatedPair }),
    });
    const onSaved = vi.fn();
    const { result } = renderHook(
      () => useQAPairEdit(PAIR_ID, onSaved),
      hookWrapper(),
    );

    await act(async () => {
      await result.current.saveEdit('answer_standard', 'New answer');
    });

    expect(mockFetch).toHaveBeenCalledWith(`/api/q-a-pairs/${PAIR_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answer_standard: 'New answer',
        edit_intent: 'data',
      }),
    });
    expect(onSaved).toHaveBeenCalledWith(updatedPair);
    expect(result.current.editingField).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it('surfaces a toast and keeps editing state on a failed save', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Failed to update Q&A pair' }),
    });
    const onSaved = vi.fn();
    const { result } = renderHook(
      () => useQAPairEdit(PAIR_ID, onSaved),
      hookWrapper(),
    );

    act(() => {
      result.current.startEdit('answer_standard', 'Current');
    });

    await act(async () => {
      await result.current.saveEdit('answer_standard', 'New answer');
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to update Q&A pair');
    expect(onSaved).not.toHaveBeenCalled();
    // Failed save does not clear editing state — the user's in-progress edit
    // is preserved so they can retry rather than silently losing it.
    expect(result.current.editingField).toBe('answer_standard');
  });
});
