'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { toast } from 'sonner';

export interface UseQAEditModeParams {
  itemId: string;
  title: string;
  answerStandard: string | null | undefined;
  answerAdvanced: string | null | undefined;
  isQAPair: boolean;
  onFieldSaved: (field: string, value: string | null) => void;
}

export interface UseQAEditModeReturn {
  isEditing: boolean;
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  editDirty: boolean;
  setEditDirty: React.Dispatch<React.SetStateAction<boolean>>;
  editTitle: string;
  setEditTitle: React.Dispatch<React.SetStateAction<string>>;
  editStandard: string;
  setEditStandard: React.Dispatch<React.SetStateAction<string>>;
  editAdvanced: string;
  setEditAdvanced: React.Dispatch<React.SetStateAction<string>>;
  isSavingTab: boolean;
  setIsSavingTab: React.Dispatch<React.SetStateAction<boolean>>;
  enterEditMode: () => void;
  cancelEditMode: () => void;
  handleSaveAll: () => Promise<void>;
}

interface SaveAllVariables {
  editTitle: string;
  title: string;
  editStandard: string;
  editAdvanced: string;
  answerStandard: string | null | undefined;
  answerAdvanced: string | null | undefined;
  isQAPair: boolean;
  itemId: string;
  onFieldSaved: (field: string, value: string | null) => void;
}

async function patchField(itemId: string, field: string, value: string | null): Promise<void> {
  const res = await fetch(`/api/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ field, value }),
  });
  if (!res.ok) throw new Error(`Failed to save ${field}`);
}

export function useQAEditMode({
  itemId,
  title,
  answerStandard,
  answerAdvanced,
  isQAPair,
  onFieldSaved,
}: UseQAEditModeParams): UseQAEditModeReturn {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editStandard, setEditStandard] = useState('');
  const [editAdvanced, setEditAdvanced] = useState('');
  const [isSavingTab, setIsSavingTab] = useState(false);

  const mutation = useMutation<void, Error, SaveAllVariables>({
    mutationFn: async (vars) => {
      // Save title if changed
      if (vars.editTitle && vars.editTitle !== vars.title) {
        await patchField(vars.itemId, 'suggested_title', vars.editTitle);
        vars.onFieldSaved('suggested_title', vars.editTitle);
      }
      // Save Q&A fields if changed
      if (vars.isQAPair) {
        if (vars.editStandard !== (vars.answerStandard ?? '')) {
          await patchField(vars.itemId, 'answer_standard', vars.editStandard || null);
          vars.onFieldSaved('answer_standard', vars.editStandard || null);
        }
        if (vars.editAdvanced !== (vars.answerAdvanced ?? '')) {
          await patchField(vars.itemId, 'answer_advanced', vars.editAdvanced || null);
          vars.onFieldSaved('answer_advanced', vars.editAdvanced || null);
        }
      }
    },
    onSuccess: () => {
      setIsEditing(false);
      setEditDirty(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.contentItems.detail(itemId) });
      toast.success('Changes saved');
    },
    onError: (err) => {
      console.error('Failed to save edits:', err);
      toast.error('Failed to save — please try again');
    },
  });

  const enterEditMode = useCallback(() => {
    setIsEditing(true);
    setEditTitle(title);
    setEditStandard(answerStandard ?? '');
    setEditAdvanced(answerAdvanced ?? '');
    setEditDirty(false);
  }, [title, answerStandard, answerAdvanced]);

  const cancelEditMode = useCallback(() => {
    setIsEditing(false);
    setEditDirty(false);
    setEditTitle('');
  }, []);

  const handleSaveAll = useCallback(async () => {
    try {
      await mutation.mutateAsync({
        editTitle,
        title,
        editStandard,
        editAdvanced,
        answerStandard,
        answerAdvanced,
        isQAPair,
        itemId,
        onFieldSaved,
      });
    } catch {
      // Error already handled via onError callback
    }
  }, [mutation, editTitle, title, editStandard, editAdvanced, answerStandard, answerAdvanced, isQAPair, itemId, onFieldSaved]);

  return {
    isEditing,
    setIsEditing,
    editDirty,
    setEditDirty,
    editTitle,
    setEditTitle,
    editStandard,
    setEditStandard,
    editAdvanced,
    setEditAdvanced,
    isSavingTab,
    setIsSavingTab,
    enterEditMode,
    cancelEditMode,
    handleSaveAll,
  };
}
