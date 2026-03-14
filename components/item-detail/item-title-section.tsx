'use client';

import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VerificationBadge } from '@/components/verification-badge';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

export interface ItemTitleSectionProps {
  item: ItemData;
  title: string;
  isEditing: boolean;
  editDirty: boolean;
  editTitle: string;
  setEditTitle: React.Dispatch<React.SetStateAction<string>>;
  setEditDirty: React.Dispatch<React.SetStateAction<boolean>>;
  handleSaveAll: () => void;
  cancelEditMode: () => void;
}

/**
 * Title display with inline editing support and editing banner.
 * Shows verification badge and source document when applicable.
 */
export function ItemTitleSection({
  item,
  title,
  isEditing,
  editDirty,
  editTitle,
  setEditTitle,
  setEditDirty,
  handleSaveAll,
  cancelEditMode,
}: ItemTitleSectionProps) {
  return (
    <>
      {/* Title + inline badges */}
      <div className="mb-2">
        {isEditing ? (
          <Input
            autoFocus
            value={editTitle}
            onChange={(e) => {
              setEditTitle(e.target.value);
              setEditDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveAll();
              if (e.key === 'Escape') cancelEditMode();
            }}
            className="text-xl font-bold"
          />
        ) : (
          <h1 className="text-fluid-xl font-bold leading-tight break-words">{title}</h1>
        )}
        {/* Inline badges */}
        {(item.verified_at || item.source_document) && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <VerificationBadge verified={!!item.verified_at} size="md" />
            {item.source_document && (
              <span className="text-xs text-muted-foreground">
                Source: <span className="font-medium text-foreground/80">{item.source_document}</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Editing banner */}
      {isEditing && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-status-warning/30 bg-quality-moderate-bg px-4 py-2 text-sm">
          <span className="flex items-center gap-1.5 font-medium text-status-warning">
            <Pencil className="size-3.5 shrink-0" aria-hidden="true" />
            Editing{editDirty ? ' \u2014 unsaved changes' : ''}
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSaveAll}>Save</Button>
            <Button size="sm" variant="outline" onClick={cancelEditMode}>Cancel</Button>
          </div>
        </div>
      )}
    </>
  );
}
