'use client';

import { Button } from '@/components/ui/button';
import { ChangeReasonInput } from '@/components/item-detail/change-reason-input';
import {
  SAVE_SAFETY_BLOCK_MESSAGE,
  shouldBlockSave,
} from '@/lib/editor/save-safety';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';
import type { ContentTabsEditConfig } from '@/components/item-detail/content-tabs';

const ContentEditor = dynamic(
  () =>
    import('@/components/item-detail/content-editor').then(
      (mod) => mod.ContentEditor,
    ),
  {
    ssr: false,
    loading: () => <div className="h-48 animate-pulse rounded-lg bg-accent" />,
  },
);

export interface InlineContentEditorProps {
  editConfig: ContentTabsEditConfig;
  /** Whether the 'content' field is currently being edited */
  isEditing: boolean;
  /** The current persisted content value (used as baseline for save-safety) */
  currentContent: string | null | undefined;
}

/**
 * TipTap-based rich content editor for the canonical `content` tab.
 * Includes save-safety guard, re-generate embedding / re-classify checkboxes,
 * "Why change?" reason input, and save/cancel buttons.
 * Shows a per-field save hint below the editor.
 *
 * Q&A items edit `answer_standard` / `answer_advanced` via
 * `qa-answer-display.tsx` (single-field-at-a-time), NOT this component —
 * so the previous `isQAPair` placeholder branch was dead and is removed.
 */
export function InlineContentEditor({
  editConfig,
  isEditing,
  currentContent,
}: InlineContentEditorProps) {
  if (!isEditing) return null;

  // Save-safety guard for the Save-button path. Baseline is the
  // last-persisted canonical markdown. The new length is the in-flight edit
  // buffer. Both sides are measured in canonical markdown units so the
  // ratio is meaningful. See `lib/editor/save-safety.ts` for the threshold
  // and rationale. On block, we surface the canonical toast copy and keep
  // the user in edit mode so they can recover their work.
  const baselineLength = currentContent?.length ?? 0;
  const handleSaveClick = () => {
    const nextLength = editConfig.editValue?.length ?? 0;
    if (shouldBlockSave(baselineLength, nextLength)) {
      toast.error(SAVE_SAFETY_BLOCK_MESSAGE);
      return;
    }
    editConfig.onSaveEdit('content');
  };

  return (
    <div className="space-y-3">
      <ContentEditor
        content={editConfig.editValue}
        onChange={editConfig.onEditValueChange}
        // Secondary guard on Cmd+S. Invokes the save-edit callback on
        // success; identical block behaviour to the Save button.
        onSave={() => editConfig.onSaveEdit('content')}
        // Explicit baseline -- `content` here is the two-way-bound edit
        // buffer, so the ContentEditor can't fall back to it safely.
        baselineLength={baselineLength}
        placeholder="Edit content\u2026"
        minHeight="200px"
      />
      <div className="flex flex-wrap items-center gap-4">
        {editConfig.onRegenerateEmbeddingChange && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={editConfig.regenerateEmbedding ?? false}
              onChange={(e) =>
                editConfig.onRegenerateEmbeddingChange!(e.target.checked)
              }
              className="accent-primary"
            />
            Re-generate embedding
          </label>
        )}
        {editConfig.onReclassifyChange && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={editConfig.reclassifyAfterSave ?? false}
              onChange={(e) => editConfig.onReclassifyChange!(e.target.checked)}
              className="accent-primary"
            />
            Re-classify after save
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Changes are saved per field -- other fields remain unchanged.
      </p>
      <ChangeReasonInput editConfig={editConfig} />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSaveClick}
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
