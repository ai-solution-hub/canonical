'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';
import { validateEditableField } from '@/lib/validation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseInlineFieldEditParams<
  T extends object = Record<string, unknown>,
> {
  itemId: string;
  /** Setter to update the parent item state optimistically */
  onItemUpdate: (updater: (prev: T) => T) => void;
}

export interface UseInlineFieldEditReturn {
  editingField: string | null;
  editValue: string;
  saveSuccess: string | null;
  saveAnnouncement: string;
  /** Whether a save operation is currently in progress */
  isSaving: boolean;
  startEdit: (field: string, currentValue: unknown) => void;
  cancelEdit: () => void;
  /**
   * S153 WP3(a): optional `changeReason` propagates to PATCH body as
   * `change_reason`, captured on the server into `content_history.change_reason`.
   * NULL-acceptable — admin UI may or may not supply a reason.
   *
   * S198 §1.5 WP4: optional `extras.regenerate_embedding` is forwarded to the
   * PATCH body when truthy. When omitted, the hook also reads the internal
   * `regenerateEmbedding` state below as a fallback so consumers can drive the
   * flag via either path.
   */
  saveEdit: (
    field: string,
    value: unknown,
    changeReason?: string | null,
    extras?: { regenerate_embedding?: boolean },
  ) => Promise<void>;
  setEditValue: (value: string) => void;
  /**
   * S198 §1.5 WP4: per-edit "Re-generate embedding" toggle. Optional in the
   * return shape so unit-test fixtures and historical consumers that don't set
   * it via `setRegenerateEmbedding` continue to work unchanged.
   */
  regenerateEmbedding: boolean;
  setRegenerateEmbedding: (value: boolean) => void;
}

interface SaveEditVariables {
  field: string;
  value: unknown;
  changeReason?: string | null;
  regenerateEmbedding?: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInlineFieldEdit<T extends object = Record<string, unknown>>({
  itemId,
  onItemUpdate,
}: UseInlineFieldEditParams<T>): UseInlineFieldEditReturn {
  const queryClient = useQueryClient();
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveAnnouncement, setSaveAnnouncement] = useState('');
  // S198 §1.5 WP4: per-edit "Re-generate embedding" flag. Owned here so the
  // QA edit panel (and other inline-edit consumers) can ride a single
  // checkbox without each parent re-implementing the wiring. Reset to false
  // after every successful save so it does not leak across fields.
  const [regenerateEmbedding, setRegenerateEmbedding] = useState(false);

  const mutation = useMutation<
    void,
    Error,
    SaveEditVariables,
    { previousValue: unknown }
  >({
    mutationFn: async ({
      field,
      value,
      changeReason,
      regenerateEmbedding: regenFlag,
    }) => {
      if (!validateEditableField(field)) {
        throw new Error(`Field "${field}" is not editable`);
      }

      // S153 WP3(a): only include change_reason when non-empty. Empty string
      // or null → omit the field so the server persists NULL (acceptable
      // default per data-entry-points.md Appendix D).
      const trimmedReason =
        typeof changeReason === 'string' ? changeReason.trim() : '';
      const body: Record<string, unknown> = { field, value };
      if (trimmedReason.length > 0) body.change_reason = trimmedReason;
      // S198 §1.5 WP4: forward regen-embedding only when truthy. Server-side
      // schema (`lib/validation/schemas.ts:294`) accepts the boolean; PATCH
      // route (`app/api/items/[id]/route.ts:55,563`) consumes it.
      if (regenFlag) body.regenerate_embedding = true;

      const res = await fetch(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Update failed');
      }
    },
    onMutate: async ({ field, value }) => {
      // Optimistic update — capture previous value for rollback
      let previousValue: unknown;
      onItemUpdate((prev) => {
        previousValue = (prev as Record<string, unknown>)[field];
        return { ...prev, [field]: value } as T;
      });
      setEditingField(null);
      return { previousValue };
    },
    onSuccess: (_data, { field }) => {
      setSaveSuccess(field);
      setSaveAnnouncement('Title saved');
      // S198 §1.5 WP4: reset the per-edit regen-embedding toggle after a
      // successful save so it does not silently apply to the next field.
      setRegenerateEmbedding(false);
      setTimeout(() => {
        setSaveSuccess(null);
        setSaveAnnouncement('');
      }, 1500);
      queryClient.invalidateQueries({
        queryKey: queryKeys.contentItems.detail(itemId),
      });
    },
    onError: (_error, { field }, context) => {
      // Rollback
      if (context) {
        onItemUpdate(
          (prev) => ({ ...prev, [field]: context.previousValue }) as T,
        );
      }
      setSaveAnnouncement('Save failed');
      setTimeout(() => setSaveAnnouncement(''), 1500);
      toast.error('Failed to save — please try again');
    },
  });

  const startEdit = useCallback((field: string, currentValue: unknown) => {
    setEditingField(field);
    setEditValue(String(currentValue ?? ''));
    // S198 §1.5 WP4 — H1 fix: reset the per-edit regen-embedding toggle when
    // entering a fresh edit so the flag does not leak from a prior cancelled
    // edit on a different field. Same hook instance is shared by every
    // inline-edit consumer; a sticky `true` here would silently fire
    // regenerate_embedding on subsequent unrelated saves.
    setRegenerateEmbedding(false);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue('');
    // S198 §1.5 WP4 — H1 fix: same rationale as `startEdit`. Cancelling an
    // edit must clear the per-edit regen-embedding toggle so the next save
    // (potentially on a different field via the same hook instance) does
    // not silently regenerate the embedding.
    setRegenerateEmbedding(false);
  }, []);

  const { mutateAsync: fieldMutateAsync } = mutation;

  const saveEdit = useCallback(
    async (
      field: string,
      value: unknown,
      changeReason?: string | null,
      extras?: { regenerate_embedding?: boolean },
    ) => {
      if (!validateEditableField(field)) {
        console.error(`Field "${field}" is not editable`);
        toast.error('This field cannot be edited');
        return;
      }

      try {
        // S198 §1.5 WP4: precedence — explicit caller `extras` wins over the
        // hook-internal `regenerateEmbedding` state, so call sites that pre-
        // date the internal state continue to behave deterministically.
        const explicitRegen = extras?.regenerate_embedding;
        const regenFlag =
          typeof explicitRegen === 'boolean'
            ? explicitRegen
            : regenerateEmbedding;
        await fieldMutateAsync({
          field,
          value,
          changeReason,
          regenerateEmbedding: regenFlag,
        });
      } catch {
        // Error already handled via onError callback
      }
    },
    [fieldMutateAsync, regenerateEmbedding],
  );

  return {
    editingField,
    editValue,
    saveSuccess,
    saveAnnouncement,
    isSaving: mutation.isPending,
    startEdit,
    cancelEdit,
    saveEdit,
    setEditValue,
    regenerateEmbedding,
    setRegenerateEmbedding,
  };
}
