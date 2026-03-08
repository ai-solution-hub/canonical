'use client';

import { useState, useCallback } from 'react';
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInlineFieldEdit<T extends object = Record<string, unknown>>({
  itemId,
  onItemUpdate,
}: UseInlineFieldEditParams<T>): UseInlineFieldEditReturn {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveAnnouncement, setSaveAnnouncement] = useState('');

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

      // Store for rollback
      let previousValue: unknown;
      onItemUpdate((prev) => {
        previousValue = (prev as Record<string, unknown>)[field];
        return { ...prev, [field]: value } as T;
      });
      setEditingField(null);

      try {
        const res = await fetch(`/api/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field, value }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Update failed');
        }

        setSaveSuccess(field);
        setSaveAnnouncement('Title saved');
        setTimeout(() => {
          setSaveSuccess(null);
          setSaveAnnouncement('');
        }, 1500);
      } catch {
        // Rollback
        onItemUpdate((prev) => ({ ...prev, [field]: previousValue } as T));
        setSaveAnnouncement('Save failed');
        setTimeout(() => setSaveAnnouncement(''), 1500);
        toast.error('Failed to save — please try again');
      }
    },
    [itemId, onItemUpdate],
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
