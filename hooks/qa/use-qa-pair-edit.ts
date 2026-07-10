'use client';

import { useCallback, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchJson } from '@/lib/query/fetchers';
import type { Tables } from '@/supabase/types/database.types';

type QAPairRow = Tables<'q_a_pairs'>;

/**
 * useQAPairEdit — wires the `/library/[id]` viewer's `QAAnswerDisplay`
 * (`components/qa/qa-answer-display.tsx`) inline-edit affordance to the
 * live-but-previously-uncalled `PATCH /api/q-a-pairs/[id]` route (ID-135
 * {135.22}).
 *
 * Implements the `QAAnswerInlineEdit` contract `QAAnswerDisplay` expects.
 * Answer-field edits (`answer_standard`/`answer_advanced`) are always stamped
 * `edit_intent: 'data'` — a content change, never `'cosmetic'`/`'structural'`
 * (`lib/edit-intent/arbitrate.ts` EditIntent union) — this viewer has no UI
 * for classifying the edit more finely, and 'data' is the correct default for
 * a Q&A answer body edit.
 *
 * `changeReason`/`extras.regenerate_embedding` (the third/fourth `saveEdit`
 * params) are accepted for interface compatibility but unused: the PATCH
 * route's `QAPairUpdateSchema` has no free-text change-reason column, and
 * `regenerate_embedding` is only offered when the caller supplies
 * `setRegenerateEmbedding` — this hook does not, so `QAAnswerDisplay` never
 * renders that checkbox and `extras` is always `undefined` in practice.
 *
 * On a failed save the editing state is preserved (not cleared) so the
 * user's in-progress edit survives a transient failure and they can retry.
 */
export function useQAPairEdit(
  pairId: string,
  onSaved: (row: QAPairRow) => void,
) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      fetchJson<{ q_a_pair: QAPairRow }>(`/api/q-a-pairs/${pairId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
  });

  const startEdit = useCallback((field: string, currentValue: unknown) => {
    setEditingField(field);
    setEditValue(typeof currentValue === 'string' ? currentValue : '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
  }, []);

  const { mutateAsync } = mutation;
  const saveEdit = useCallback(
    async (
      field: string,
      value: unknown,
      _changeReason?: string | null,
      _extras?: { regenerate_embedding?: boolean },
    ) => {
      try {
        const result = await mutateAsync({
          [field]: value,
          edit_intent: 'data',
        });
        onSaved(result.q_a_pair);
        setEditingField(null);
        toast.success('Answer saved');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save');
      }
    },
    [mutateAsync, onSaved],
  );

  return {
    editingField,
    editValue,
    isSaving: mutation.isPending,
    startEdit,
    cancelEdit,
    saveEdit,
    setEditValue,
  };
}
