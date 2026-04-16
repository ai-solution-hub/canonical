'use client';

import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface EditButtonProps {
  field: 'brief' | 'detail' | 'reference' | 'content';
  label?: string;
  canEdit: boolean;
  isEditing: boolean;
  onStartEdit: (field: 'brief' | 'detail' | 'reference' | 'content') => void;
}

/**
 * Pencil button to start editing a content tab field.
 * Returns null when editing is not allowed or the field is already being edited.
 */
export function EditButton({
  field,
  label,
  canEdit,
  isEditing,
  onStartEdit,
}: EditButtonProps) {
  if (!canEdit || isEditing) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onStartEdit(field)}
      className="gap-1.5 text-xs"
    >
      <Pencil className="size-3" aria-hidden="true" />
      {label ?? 'Edit'}
    </Button>
  );
}
