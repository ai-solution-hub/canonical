'use client';

import type { ProcurementQuestion } from '@/types/procurement';

/**
 * STUB — scaffolded by ID-145 {145.42} (145W-2), FILLED by {145.44}.
 *
 * {145.44} renders the question surfaces consuming the {145.18} shape:
 * mixed per-question states (drafted/approved/matched/empty) shown HONESTLY
 * (BI-40 — no all-or-nothing framing), with a zero-candidate question
 * offering a manual-answer affordance -> optional corpus promotion (closes
 * the BI-22 gap loop / BI-24 catalogue). Drafting/authoring stays secondary
 * ({145.45} re-points the existing drafting stack). This stub renders a
 * minimal placeholder — props are the {145.18} question/stats shape plus the
 * handlers {145.44} needs, so that subtask never has to re-edit `page.tsx`.
 */
export interface ItemQuestionsPanelProps {
  procurementId: string;
  questions: ProcurementQuestion[];
  canEdit: boolean;
  totalQuestions: number;
  unmatchedCount?: number;
  onMatchQuestions?: () => void;
  onDraftAll?: () => void;
  draftingAll?: boolean;
  onQuestionsChanged?: () => void;
  className?: string;
}

export function ItemQuestionsPanel({
  totalQuestions,
  className,
}: ItemQuestionsPanelProps) {
  return (
    <div
      data-testid="item-questions-panel"
      className={className ?? 'rounded-lg border bg-card p-4'}
    >
      <p className="text-sm text-muted-foreground">
        Questions panel — {totalQuestions} question
        {totalQuestions === 1 ? '' : 's'}. ({'{145.44}'} wires the honest
        per-question states + zero-candidate manual-answer affordance here.)
      </p>
    </div>
  );
}
