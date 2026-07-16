'use client';

import type { ProcurementQuestionStats } from '@/types/procurement';
import type { ReadinessData } from '@/hooks/procurement/use-procurement-readiness';

/**
 * STUB — scaffolded by ID-145 {145.42} (145W-2), FILLED by {145.44}.
 *
 * {145.44} renders the coverage surfaces consuming the {145.18} shape:
 * drafting progress, confidence-posture breakdown, and submission
 * readiness — the same honest-per-question-state discipline (BI-40) applied
 * at the roll-up level. This stub renders a minimal placeholder — props are
 * the {145.18} stats shape plus the already-fetched `useProcurementReadiness`
 * result {145.44} needs, so that subtask never has to re-edit `page.tsx` (or
 * re-fetch readiness itself — `page.tsx` already calls the hook for the
 * header's `ReadinessBadge`).
 */
export interface ItemCoveragePanelProps {
  procurementId: string;
  stats: ProcurementQuestionStats | null;
  totalQuestions: number;
  completedCount: number;
  progressPercent: number;
  canEdit: boolean;
  readiness: ReadinessData | null;
  readinessLoading: boolean;
  readinessError: string | null;
  onRefreshReadiness: () => void;
  className?: string;
}

export function ItemCoveragePanel({
  totalQuestions,
  completedCount,
  className,
}: ItemCoveragePanelProps) {
  return (
    <div
      data-testid="item-coverage-panel"
      className={className ?? 'rounded-lg border bg-card p-4'}
    >
      <p className="text-sm text-muted-foreground">
        Coverage panel — {completedCount} of {totalQuestions} covered. (
        {'{145.44}'} wires the confidence breakdown + submission readiness
        here.)
      </p>
    </div>
  );
}
