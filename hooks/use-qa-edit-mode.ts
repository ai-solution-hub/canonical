'use client';

import { useState, useCallback } from 'react';
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

export function useQAEditMode({
  itemId,
  title,
  answerStandard,
  answerAdvanced,
  isQAPair,
  onFieldSaved,
}: UseQAEditModeParams): UseQAEditModeReturn {
  const [isEditing, setIsEditing] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editStandard, setEditStandard] = useState('');
  const [editAdvanced, setEditAdvanced] = useState('');
  const [isSavingTab, setIsSavingTab] = useState(false);

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
      // Save title if changed
      if (editTitle && editTitle !== title) {
        const res = await fetch(`/api/items/${itemId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ field: 'suggested_title', value: editTitle }),
        });
        if (!res.ok) throw new Error('Failed to save title');
        onFieldSaved('suggested_title', editTitle);
      }
      // Save Q&A fields if changed
      if (isQAPair) {
        if (editStandard !== (answerStandard ?? '')) {
          const res = await fetch(`/api/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field: 'answer_standard', value: editStandard || null }),
          });
          if (!res.ok) throw new Error('Failed to save standard answer');
          onFieldSaved('answer_standard', editStandard || null);
        }
        if (editAdvanced !== (answerAdvanced ?? '')) {
          const res = await fetch(`/api/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ field: 'answer_advanced', value: editAdvanced || null }),
          });
          if (!res.ok) throw new Error('Failed to save advanced answer');
          onFieldSaved('answer_advanced', editAdvanced || null);
        }
      }
      setIsEditing(false);
      setEditDirty(false);
      toast.success('Changes saved');
    } catch (err) {
      console.error('Failed to save edits:', err);
      toast.error('Failed to save — please try again');
    }
  }, [editTitle, title, itemId, isQAPair, editStandard, editAdvanced, answerStandard, answerAdvanced, onFieldSaved]);

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
