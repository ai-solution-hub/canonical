'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

export interface QAAnswerDisplayProps {
  item: ItemData;
  isEditing: boolean;
  editStandard: string;
  editAdvanced: string;
  setEditStandard: React.Dispatch<React.SetStateAction<string>>;
  setEditAdvanced: React.Dispatch<React.SetStateAction<string>>;
  setEditDirty: React.Dispatch<React.SetStateAction<boolean>>;
  handleCopyAnswer: (variant?: 'standard' | 'advanced') => void;
}

export function QAAnswerDisplay({
  item,
  isEditing,
  editStandard,
  editAdvanced,
  setEditStandard,
  setEditAdvanced,
  setEditDirty,
  handleCopyAnswer,
}: QAAnswerDisplayProps) {
  return (
    <div className="mb-6 space-y-4">
      {(item.answer_standard || isEditing) && (
        <div className="rounded-xl border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)]">
          <div className="flex items-center justify-between border-b border-[var(--color-highlight-border)] px-4 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Standard Answer
            </span>
            {!isEditing && (
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
          <div className="p-4">
            {isEditing ? (
              <textarea
                value={editStandard}
                onChange={(e) => { setEditStandard(e.target.value); setEditDirty(true); }}
                className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Standard answer..."
                aria-label="Standard answer"
              />
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer_standard}</p>
            )}
          </div>
        </div>
      )}
      {(item.answer_advanced || isEditing) && (
        <div className="rounded-xl border border-[var(--color-highlight-border)] bg-[var(--color-highlight-bg)]">
          <div className="flex items-center justify-between border-b border-[var(--color-highlight-border)] px-4 py-2.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Advanced Answer
            </span>
            {!isEditing && (
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
          <div className="p-4">
            {isEditing ? (
              <textarea
                value={editAdvanced}
                onChange={(e) => { setEditAdvanced(e.target.value); setEditDirty(true); }}
                className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Advanced answer..."
                aria-label="Advanced answer"
              />
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-line">{item.answer_advanced}</p>
            )}
          </div>
        </div>
      )}
      {!item.answer_standard && !item.answer_advanced && !isEditing && item.content && (
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm leading-relaxed whitespace-pre-line">{item.content}</p>
        </div>
      )}
      {!item.answer_standard && !item.answer_advanced && !isEditing && !item.content && (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No answer recorded yet.</p>
        </div>
      )}
    </div>
  );
}
