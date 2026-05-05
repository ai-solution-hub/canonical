'use client';

import { Button } from '@/components/ui/button';
import { ChangeReasonInput } from '@/components/item-detail/change-reason-input';
import type { ContentTabsEditConfig } from '@/components/item-detail/content-tabs';

/** @public */
export interface InlineTextEditorProps {
  field: 'brief' | 'detail' | 'reference';
  editConfig: ContentTabsEditConfig;
  /** Whether this field is currently being edited */
  isEditing: boolean;
}

/**
 * Inline textarea editor for text-based content tab fields (brief, detail, reference).
 * Includes the "Why change?" reason input and save/cancel buttons.
 * Shows a per-field save hint below the textarea.
 */
export function InlineTextEditor({
  field,
  editConfig,
  isEditing,
}: InlineTextEditorProps) {
  if (!isEditing) return null;
  return (
    <div className="space-y-2">
      <textarea
        value={editConfig.editValue}
        onChange={(e) => editConfig.onEditValueChange(e.target.value)}
        className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        rows={6}
        autoFocus
        aria-label={`Edit ${field}`}
      />
      <p className="text-xs text-muted-foreground">
        Changes are saved per field -- other fields remain unchanged.
      </p>
      <ChangeReasonInput editConfig={editConfig} />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => editConfig.onSaveEdit(field)}
          disabled={editConfig.isSaving}
        >
          {editConfig.isSaving ? 'Saving\u2026' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={editConfig.onCancelEdit}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
