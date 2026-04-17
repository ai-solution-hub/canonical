'use client';

import { useState } from 'react';
import { Copy, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VerificationBadge } from '@/components/shared/verification-badge';
import { cn } from '@/lib/utils';
import { ContentRenderer } from '@/components/item-detail/content-renderer';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

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
  /** Save the current edit with optional change reason */
  saveEdit: (
    field: string,
    value: unknown,
    changeReason?: string | null,
  ) => Promise<void>;
  /** Update the edit value */
  setEditValue: (value: string) => void;
}

export interface QAAnswerDisplayProps {
  item: ItemData;
  /** Inline edit state from useInlineFieldEdit */
  inlineEdit?: QAAnswerInlineEdit;
  /** Whether editing is permitted (canEdit) */
  canEdit?: boolean;
  handleCopyAnswer: (variant?: 'standard' | 'advanced') => void;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Inline textarea editor for a Q&A answer field.
 * Includes "Why change?" input, per-field save hint, and save/cancel buttons.
 */
function QAInlineEditor({
  field,
  label,
  editValue,
  isSaving,
  onValueChange,
  onSave,
  onCancel,
}: {
  field: 'answer_standard' | 'answer_advanced';
  label: string;
  editValue: string;
  isSaving: boolean;
  onValueChange: (value: string) => void;
  onSave: (field: string, value: string, changeReason: string | null) => void;
  onCancel: () => void;
}) {
  const [changeReason, setChangeReason] = useState('');

  return (
    <div className="space-y-2">
      <textarea
        value={editValue}
        onChange={(e) => onValueChange(e.target.value)}
        className="w-full min-h-[120px] rounded-md border border-input bg-card px-3 py-2 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        autoFocus
        aria-label={`Edit ${label}`}
      />
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
        <Button
          size="sm"
          onClick={() =>
            onSave(field, editValue, changeReason.trim() || null)
          }
          disabled={isSaving}
        >
          {isSaving ? 'Saving\u2026' : 'Save'}
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
}: QAAnswerDisplayProps) {
  const isVerified = !!item.verified_at;
  const borderClass = isVerified
    ? 'border-l-[3px] border-l-[var(--color-status-success)]'
    : 'border-l-[3px] border-l-[var(--color-status-warning)]';

  const editingField = inlineEdit?.editingField ?? null;
  const isEditingStandard = editingField === 'answer_standard';
  const isEditingAdvanced = editingField === 'answer_advanced';
  // Whether *any* inline edit is active (for hiding copy buttons)
  const isAnyFieldEditing = editingField !== null;

  const handleSave = async (
    field: string,
    value: string,
    changeReason: string | null,
  ) => {
    if (inlineEdit) {
      await inlineEdit.saveEdit(field, value, changeReason);
    }
  };

  return (
    <div className="mb-6 space-y-4">
      {(item.answer_standard || isEditingStandard) && (
        <div
          className={cn(
            'rounded-xl border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)]',
            borderClass,
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-highlight-border)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
                label="Standard answer"
                editValue={inlineEdit.editValue}
                isSaving={inlineEdit.isSaving}
                onValueChange={inlineEdit.setEditValue}
                onSave={handleSave}
                onCancel={inlineEdit.cancelEdit}
              />
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {item.answer_standard}
              </p>
            )}
          </div>
        </div>
      )}
      {(item.answer_advanced || isEditingAdvanced) && (
        <div
          className={cn(
            'rounded-xl border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)]',
            borderClass,
          )}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-highlight-border)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
                label="Advanced answer"
                editValue={inlineEdit.editValue}
                isSaving={inlineEdit.isSaving}
                onValueChange={inlineEdit.setEditValue}
                onSave={handleSave}
                onCancel={inlineEdit.cancelEdit}
              />
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-line">
                {item.answer_advanced}
              </p>
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
            <div className="text-sm leading-relaxed">
              <ContentRenderer content={item.content} />
            </div>
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
