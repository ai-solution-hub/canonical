'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';
import { validateEditableField } from '@/lib/validation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseInlineFieldEditParams<T extends object = Record<string, unknown>> {
  itemId: string;
  /** Setter to update the parent item state optimistically */
  onItemUpdate: (updater: (prev: T) => T) => void;
}

export interface UseInlineFieldEditReturn {
  editingField: string | null;
  editValue: string;
  saveSuccess: string | null;
  saveAnnouncement: string;
  startEdit: (field: string, currentValue: unknown) => void;
  cancelEdit: () => void;
  saveEdit: (field: string, value: unknown) => Promise<void>;
  setEditValue: (value: string) => void;
}

interface SaveEditVariables {
  field: string;
  value: unknown;
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

  const mutation = useMutation<void, Error, SaveEditVariables, { previousValue: unknown }>({
    mutationFn: async ({ field, value }) => {
      if (!validateEditableField(field)) {
        throw new Error(`Field "${field}" is not editable`);
      }

      const res = await fetch(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
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
      setTimeout(() => {
        setSaveSuccess(null);
        setSaveAnnouncement('');
      }, 1500);
      queryClient.invalidateQueries({ queryKey: queryKeys.contentItems.detail(itemId) });
    },
    onError: (_error, { field }, context) => {
      // Rollback
      if (context) {
        onItemUpdate((prev) => ({ ...prev, [field]: context.previousValue } as T));
      }
      setSaveAnnouncement('Save failed');
      setTimeout(() => setSaveAnnouncement(''), 1500);
      toast.error('Failed to save — please try again');
    },
  });

  const startEdit = useCallback((field: string, currentValue: unknown) => {
    setEditingField(field);
    setEditValue(String(currentValue ?? ''));
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingField(null);
    setEditValue('');
  }, []);

  const saveEdit = useCallback(
    async (field: string, value: unknown) => {
      if (!validateEditableField(field)) {
        console.error(`Field "${field}" is not editable`);
        toast.error('This field cannot be edited');
        return;
      }

      try {
        await mutation.mutateAsync({ field, value });
      } catch {
        // Error already handled via onError callback
      }
    },
    [mutation],
  );

  return {
    editingField,
    editValue,
    saveSuccess,
    saveAnnouncement,
    startEdit,
    cancelEdit,
    saveEdit,
    setEditValue,
  };
}
