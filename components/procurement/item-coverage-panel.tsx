'use client';

import { Upload } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { ConfidenceDot } from '@/components/shared/confidence-badge';
import { ReadinessChecklist } from '@/components/procurement/readiness-checklist';
import type {
  ConfidencePosture,
  ProcurementQuestionStats,
} from '@/types/procurement';
import type { ReadinessData } from '@/hooks/procurement/use-procurement-readiness';

/**
 * ID-145 {145.44} (BI-40, roll-up level). Renders the coverage surfaces
 * consuming the {145.18} stats shape: drafting progress, confidence-posture
 * breakdown, and submission readiness — applying the same honest,
 * no-all-or-nothing-framing discipline as the per-question panel, but at the
 * roll-up level (an honest empty state rather than a mislabelled zero when
 * there is nothing to show yet, mirroring PRODUCT invariant 32's dashboard
 * precedent). Reuses the existing `ReadinessChecklist` component wholesale —
 * no new readiness UI is introduced here.
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

interface PostureCount {
  posture: ConfidencePosture;
  count: number;
}

function derivePostureBreakdown(
  stats: ProcurementQuestionStats | null,
): PostureCount[] {
  if (!stats) return [];
  return (
    [
      { posture: 'strong_match', count: stats.strong_match_count },
      { posture: 'partial_match', count: stats.partial_match_count },
      { posture: 'needs_sme', count: stats.needs_sme_count },
      { posture: 'no_content', count: stats.no_content_count },
    ] as PostureCount[]
  ).filter((p) => p.count > 0);
}

function ProgressCard({
  totalQuestions,
  completedCount,
  progressPercent,
}: {
  totalQuestions: number;
  completedCount: number;
  progressPercent: number;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium text-foreground">Progress</h2>
      {totalQuestions > 0 ? (
        <div className="mt-3 space-y-2">
          <Progress value={progressPercent} className="h-2" />
          <p className="text-sm text-muted-foreground">
            {completedCount} of {totalQuestions} questions drafted (
            {progressPercent}%)
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-6 text-center">
          <Upload
            className="size-6 text-muted-foreground/50"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            No questions extracted yet.
          </p>
          <p className="text-xs text-muted-foreground/70">
            Questions will be automatically extracted from your tender document.
          </p>
        </div>
      )}
    </div>
  );
}

function ConfidenceBreakdownCard({ breakdown }: { breakdown: PostureCount[] }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-medium text-foreground">
        Confidence Breakdown
      </h2>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
        {breakdown.map(({ posture, count }) => (
          <ConfidenceDot key={posture} posture={posture} count={count} />
        ))}
      </div>
    </div>
  );
}

export function ItemCoveragePanel({
  stats,
  totalQuestions,
  completedCount,
  progressPercent,
  canEdit,
  readiness,
  readinessLoading,
  readinessError,
  onRefreshReadiness,
  className,
}: ItemCoveragePanelProps) {
  const postureBreakdown = derivePostureBreakdown(stats);

  return (
    <div data-testid="item-coverage-panel" className={className ?? 'space-y-4'}>
      <div className="grid gap-4 sm:grid-cols-2">
        <ProgressCard
          totalQuestions={totalQuestions}
          completedCount={completedCount}
          progressPercent={progressPercent}
        />
        {postureBreakdown.length > 0 && (
          <ConfidenceBreakdownCard breakdown={postureBreakdown} />
        )}
      </div>

      {canEdit && totalQuestions > 0 && (
        <ReadinessChecklist
          readiness={readiness}
          isLoading={readinessLoading}
          error={readinessError}
          onRefresh={onRefreshReadiness}
        />
      )}
    </div>
  );
}
