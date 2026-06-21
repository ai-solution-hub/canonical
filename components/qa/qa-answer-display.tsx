'use client';

import { useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Copy, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import type { Editor } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { VerificationBadge } from '@/components/shared/verification-badge';
import { cn } from '@/lib/utils';
import { QAPairRenderer } from '@/components/qa/qa-pair-renderer';
import {
  SAVE_SAFETY_BLOCK_MESSAGE,
  shouldBlockSave,
} from '@/lib/editor/save-safety';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

// ---------------------------------------------------------------------------
// Dynamic ContentEditor import — matches the canonical pattern at
// `components/item-detail/inline-content-editor.tsx:13-22`. Keeps Tiptap +
// dependants out of the initial bundle and out of SSR.
// ---------------------------------------------------------------------------

const ContentEditor = dynamic(
  () =>
    import('@/components/item-detail/content-editor').then(
      (mod) => mod.ContentEditor,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-32 animate-pulse rounded-md border bg-accent" />
    ),
  },
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QAAnswerInlineEdit {
  /** Currently editing field name, or null */
  editingField: string | null;
  /** Current edit value */
  editValue: string;
  /** Whether a save is in progress */
  isSaving: boolean;
  /** Start editing a field — passes current value */
  startEdit: (field: string, currentValue: unknown) => void;
  /** Cancel the current edit */
  cancelEdit: () => void;
  /**
   * Save the current edit with optional change reason. The 4th `extras`
   * argument was added in S198 §1.5 WP4 so the QA edit panel can opt-in to
   * `regenerate_embedding` per save without rewiring every consumer.
   */
  saveEdit: (
    field: string,
    value: unknown,
    changeReason?: string | null,
    extras?: { regenerate_embedding?: boolean },
  ) => Promise<void>;
  /** Update the edit value */
  setEditValue: (value: string) => void;
  /**
   * S198 §1.5 WP4: per-edit "Re-generate embedding" toggle. Optional in the
   * interface so consumers (and unit-test fixtures) that don't supply the
   * setter render the editor without the checkbox row — graceful degradation
   * matching `editConfig.onRegenerateEmbeddingChange` in `InlineContentEditor`.
   */
  regenerateEmbedding?: boolean;
  setRegenerateEmbedding?: (value: boolean) => void;
}

export interface QAAnswerDisplayProps {
  item: ItemData;
  /** Inline edit state from useInlineFieldEdit */
  inlineEdit?: QAAnswerInlineEdit;
  /** Whether editing is permitted (canEdit) */
  canEdit?: boolean;
  handleCopyAnswer: (variant?: 'standard' | 'advanced') => void;
  /**
   * @internal Test-only hook. Forwarded to the underlying `ContentEditor` so
   * tests can drive the Tiptap editor instance directly (e.g.
   * `editor.commands.insertContent`). Mirrors the same `@internal` JSDoc
   * pattern already used on `ContentEditor.onEditorReady` — not intended for
   * production use; keyed edits should go via `inlineEdit.setEditValue`.
   */
  onEditorReady?: (editor: Editor) => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Inline rich-markdown editor for a Q&A answer field.
 *
 * S198 §1.5 WP4: replaces the previous plain text input with a dynamically-
 * imported `ContentEditor` (Tiptap + GFM tables) and wires per-field
 * baseline length so the save-safety guard composes inside the editor's
 * own `handleSave`. Includes the optional "Re-generate embedding" checkbox
 * (when the parent supplies a setter), the existing "Why change?" input,
 * and the per-field save hint.
 *
 * The save-safety baseline MUST be the last-persisted field length
 * (`item.answer_standard?.length ?? 0` or the equivalent for advanced),
 * NOT the in-flight `editValue` length — wrong baseline source = guard
 * fires on the user's own edits. The parent (`QAAnswerDisplay`) computes
 * this and passes via `baselineLength`.
 */
function QAInlineEditor({
  field,
  labelId,
  editValue,
  isSaving,
  baselineLength,
  regenerateEmbedding,
  setRegenerateEmbedding,
  onValueChange,
  onSave,
  onCancel,
  onEditorReady,
}: {
  field: 'answer_standard' | 'answer_advanced';
  /** Stable id of the answer-section label (`<span id={labelId}>`) — wired
   * into `ContentEditor`'s `aria-labelledby` for AC10. */
  labelId: string;
  editValue: string;
  isSaving: boolean;
  /** Length of the LAST-PERSISTED answer field — used as the save-safety
   * baseline (see `lib/editor/save-safety.ts`). */
  baselineLength: number;
  regenerateEmbedding?: boolean;
  setRegenerateEmbedding?: (value: boolean) => void;
  onValueChange: (value: string) => void;
  onSave: (
    field: string,
    value: string,
    changeReason: string | null,
    extras?: { regenerate_embedding?: boolean },
  ) => void;
  onCancel: () => void;
  /** @internal Test-only hook — forwarded to `ContentEditor.onEditorReady`. */
  onEditorReady?: (editor: Editor) => void;
}) {
  const [changeReason, setChangeReason] = useState('');

  // Save-safety guard for the Save-button path. The Cmd/Ctrl+S path inside
  // `ContentEditor.handleSave` runs the same `shouldBlockSave` check against
  // the same `baselineLength` prop — so both paths block consistently.
  const handleSaveClick = () => {
    if (shouldBlockSave(baselineLength, editValue.length)) {
      toast.error(SAVE_SAFETY_BLOCK_MESSAGE);
      return;
    }
    onSave(
      field,
      editValue,
      changeReason.trim() || null,
      regenerateEmbedding ? { regenerate_embedding: true } : undefined,
    );
  };

  return (
    <div className="space-y-3">
      <ContentEditor
        content={editValue}
        onChange={onValueChange}
        // Cmd/Ctrl+S parity with the Save button. The internal save-safety
        // guard inside `ContentEditor.handleSave` reads `baselineLength`
        // below; on success it invokes this callback with the latest
        // markdown — we forward that to the same `onSave` shape.
        onSave={(markdown) =>
          onSave(
            field,
            markdown,
            changeReason.trim() || null,
            regenerateEmbedding ? { regenerate_embedding: true } : undefined,
          )
        }
        baselineLength={baselineLength}
        placeholder={
          field === 'answer_standard'
            ? 'Standard answer — markdown supported'
            : 'Advanced answer — markdown supported'
        }
        minHeight="120px"
        labelId={labelId}
        autofocus
        onEditorReady={onEditorReady}
      />
      {setRegenerateEmbedding && (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={regenerateEmbedding ?? false}
              onChange={(e) => setRegenerateEmbedding(e.target.checked)}
              className="accent-primary"
            />
            Re-generate embedding
          </label>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Changes are saved per field -- other fields remain unchanged.
      </p>
      <div className="space-y-1">
        <label
          htmlFor={`qa-change-reason-${field}`}
          className="text-xs font-medium text-muted-foreground"
        >
          Why change? <span className="font-normal">(optional)</span>
        </label>
        <input
          id={`qa-change-reason-${field}`}
          type="text"
          value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)}
          placeholder="e.g. Updated to reflect 2026 rebrand"
          maxLength={500}
          className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleSaveClick} disabled={isSaving}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Display component for Q&A Standard and Advanced answers.
 * Supports per-field inline editing via `inlineEdit` from useInlineFieldEdit.
 */
export function QAAnswerDisplay({
  item,
  inlineEdit,
  canEdit = false,
  handleCopyAnswer,
  onEditorReady,
}: QAAnswerDisplayProps) {
  const isVerified = !!item.verified_at;
  const borderClass = isVerified
    ? 'border-l-[3px] border-l-[var(--status-success)]'
    : 'border-l-[3px] border-l-[var(--status-warning)]';

  const editingField = inlineEdit?.editingField ?? null;
  const isEditingStandard = editingField === 'answer_standard';
  const isEditingAdvanced = editingField === 'answer_advanced';
  // Whether *any* inline edit is active (for hiding copy buttons)
  const isAnyFieldEditing = editingField !== null;

  // S198 §1.5 WP4: stable label ids for the editor's `aria-labelledby`. AC10
  // requires keyboard-only nav to land on a labelled textbox.
  const standardLabelId = 'qa-answer-standard-label';
  const advancedLabelId = 'qa-answer-advanced-label';

  // S198 §1.5 WP4: per-field baseline derived from the LAST-PERSISTED value
  // (not the in-flight `editValue`), passed into `ContentEditor` via the
  // `baselineLength` prop so the save-safety guard composes identically on
  // both the Save-button path and the Cmd/Ctrl+S path.
  const standardBaselineLength = item.answer_standard?.length ?? 0;
  const advancedBaselineLength = item.answer_advanced?.length ?? 0;

  // S198 §1.5 WP4 — L2 fix: memoise so the prop reference passed into
  // `QAInlineEditor` (and onward to `ContentEditor.onSave`) is stable across
  // renders. Per CLAUDE.md react-compiler guidance, destructure the nested
  // `inlineEdit.saveEdit` first so the dep array tracks the inner function
  // identity instead of the outer object reference.
  const { saveEdit: inlineSaveEdit } = inlineEdit ?? {};
  const handleSave = useCallback(
    async (
      field: string,
      value: string,
      changeReason: string | null,
      extras?: { regenerate_embedding?: boolean },
    ) => {
      if (inlineSaveEdit) {
        await inlineSaveEdit(field, value, changeReason, extras);
      }
    },
    [inlineSaveEdit],
  );

  return (
    <div className="mb-6 space-y-4">
      {(item.answer_standard || isEditingStandard) && (
        <div
          data-testid="qa-answer-panel-standard"
          className={cn(
            'rounded-xl border border-[var(--highlight-border)] bg-[var(--highlight-bg)]',
            borderClass,
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--highlight-border)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span
                id={standardLabelId}
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Standard Answer
              </span>
              <VerificationBadge
                verified={isVerified}
                verifiedAt={item.verified_at}
                size="sm"
                showLabel={true}
                liveRegion={false}
              />
            </div>
            <div className="flex items-center gap-1">
              {canEdit && !isAnyFieldEditing && inlineEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() =>
                    inlineEdit.startEdit(
                      'answer_standard',
                      item.answer_standard ?? '',
                    )
                  }
                >
                  <Pencil className="size-3" aria-hidden="true" />
                  Edit
                </Button>
              )}
              {!isAnyFieldEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => handleCopyAnswer('standard')}
                >
                  <Copy className="size-3" />
                  Copy
                </Button>
              )}
            </div>
          </div>
          <div className="p-4">
            {isEditingStandard && inlineEdit ? (
              <QAInlineEditor
                field="answer_standard"
                labelId={standardLabelId}
                editValue={inlineEdit.editValue}
                isSaving={inlineEdit.isSaving}
                baselineLength={standardBaselineLength}
                regenerateEmbedding={inlineEdit.regenerateEmbedding}
                setRegenerateEmbedding={inlineEdit.setRegenerateEmbedding}
                onValueChange={inlineEdit.setEditValue}
                onSave={handleSave}
                onCancel={inlineEdit.cancelEdit}
                onEditorReady={onEditorReady}
              />
            ) : (
              <QAPairRenderer answerStandard={item.answer_standard} />
            )}
          </div>
        </div>
      )}
      {(item.answer_advanced || isEditingAdvanced) && (
        <div
          data-testid="qa-answer-panel-advanced"
          className={cn(
            'rounded-xl border border-[var(--highlight-border)] bg-[var(--highlight-bg)]',
            borderClass,
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--highlight-border)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span
                id={advancedLabelId}
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                Advanced Answer
              </span>
              <VerificationBadge
                verified={isVerified}
                verifiedAt={item.verified_at}
                size="sm"
                showLabel={true}
                liveRegion={false}
              />
            </div>
            <div className="flex items-center gap-1">
              {canEdit && !isAnyFieldEditing && inlineEdit && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() =>
                    inlineEdit.startEdit(
                      'answer_advanced',
                      item.answer_advanced ?? '',
                    )
                  }
                >
                  <Pencil className="size-3" aria-hidden="true" />
                  Edit
                </Button>
              )}
              {!isAnyFieldEditing && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => handleCopyAnswer('advanced')}
                >
                  <Copy className="size-3" />
                  Copy
                </Button>
              )}
            </div>
          </div>
          <div className="p-4">
            {isEditingAdvanced && inlineEdit ? (
              <QAInlineEditor
                field="answer_advanced"
                labelId={advancedLabelId}
                editValue={inlineEdit.editValue}
                isSaving={inlineEdit.isSaving}
                baselineLength={advancedBaselineLength}
                regenerateEmbedding={inlineEdit.regenerateEmbedding}
                setRegenerateEmbedding={inlineEdit.setRegenerateEmbedding}
                onValueChange={inlineEdit.setEditValue}
                onSave={handleSave}
                onCancel={inlineEdit.cancelEdit}
                onEditorReady={onEditorReady}
              />
            ) : (
              <QAPairRenderer answerAdvanced={item.answer_advanced} />
            )}
          </div>
        </div>
      )}
      {!item.answer_standard &&
        !item.answer_advanced &&
        !isEditingStandard &&
        !isEditingAdvanced &&
        item.content && (
          <div className="rounded-xl border bg-card p-4">
            <QAPairRenderer answerStandard={item.content} />
          </div>
        )}
      {!item.answer_standard &&
        !item.answer_advanced &&
        !isEditingStandard &&
        !isEditingAdvanced &&
        !item.content && (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No answer recorded yet.
            </p>
          </div>
        )}
    </div>
  );
}
