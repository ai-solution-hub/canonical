'use client';

import Link from 'next/link';
import { Calendar, Building2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { ProcurementWorkflowBadge } from '@/components/procurement/procurement-workflow-indicator';
import { ConfidenceDot } from '@/components/shared/confidence-badge';
import { formatDateUK } from '@/lib/format';
import { getDeadlineProximity } from '@/lib/domains/procurement/procurement-helpers';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { cn } from '@/lib/utils';
import { parseProcurementMetadata } from '@/lib/validation/schemas';
import type {
  Procurement,
  ProcurementMetadata,
  ConfidencePosture,
} from '@/types/procurement';
import type { ProcurementWorkflowState } from '@/types/procurement';

/**
 * Maps each ProcurementWorkflowState to a left-border accent class using semantic bid-* tokens.
 * Classes must be written out fully for Tailwind's JIT scanner to detect them.
 */
const STATUS_BORDER_CLASS: Record<ProcurementWorkflowState, string> = {
  draft: 'border-l-form-draft-border',
  questions_extracted: 'border-l-form-discovery-border',
  matching: 'border-l-form-discovery-border',
  drafting: 'border-l-form-active-border',
  in_review: 'border-l-form-in-review-border',
  ready_for_export: 'border-l-form-export-ready-border',
  submitted: 'border-l-form-submitted-border',
  won: 'border-l-form-won-border',
  lost: 'border-l-form-lost-border',
  withdrawn: 'border-l-form-withdrawn-border',
};

interface ProcurementListCardProps {
  bid: Procurement;
  className?: string;
  /** Optional Claude prompt to show a "Take action" button */
  claudePrompt?: string;
}

export function ProcurementListCard({
  bid,
  className,
  claudePrompt,
}: ProcurementListCardProps) {
  // domain_metadata may be null (app/seed-created procurement rows with no
  // tender metadata): parse returns null and the raw fallback is also null, so
  // `metadata` can be null. Guard every access — a malformed row must degrade
  // gracefully, never crash the whole list via the ErrorBoundary.
  const metadata = (parseProcurementMetadata(bid.domain_metadata) ??
    bid.domain_metadata) as ProcurementMetadata | null;
  const buyer = metadata?.buyer ?? null;
  const deadline = metadata?.deadline ?? null;
  const procurementStatus = bid.status as ProcurementMetadata['status'];
  const stats = bid.question_stats;
  const totalQuestions = stats?.total_questions ?? 0;
  const completedCount =
    (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);
  const progressPercent =
    totalQuestions > 0
      ? Math.round((completedCount / totalQuestions) * 100)
      : 0;

  const postureBreakdown = stats
    ? [
        {
          posture: 'strong_match' as ConfidencePosture,
          count: stats.strong_match_count,
        },
        {
          posture: 'partial_match' as ConfidencePosture,
          count: stats.partial_match_count,
        },
        {
          posture: 'needs_sme' as ConfidencePosture,
          count: stats.needs_sme_count,
        },
        {
          posture: 'no_content' as ConfidencePosture,
          count: stats.no_content_count,
        },
      ].filter((p) => p.count > 0)
    : [];

  // Deadline proximity calculation (shared helper)
  const deadlineProximity = getDeadlineProximity(deadline);

  return (
    <div
      data-testid={`bid-card-${bid.id}`}
      className={cn(
        'group relative rounded-lg border border-l-4 bg-card text-card-foreground shadow-sm transition-all hover:shadow-md hover:bg-accent/50 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
        STATUS_BORDER_CLASS[procurementStatus] ?? 'border-l-form-draft-border',
        className,
      )}
    >
      <div className="flex flex-col gap-3 p-4">
        {/* Header: name + status */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-base font-semibold leading-tight">
            <Link
              href={`/procurement/${bid.id}`}
              className="text-foreground transition-colors hover:underline decoration-muted-foreground/40 outline-none after:absolute after:inset-0 after:content-['']"
            >
              {bid.name}
            </Link>
          </h3>
          <ProcurementWorkflowBadge
            state={procurementStatus}
            className="shrink-0"
          />
        </div>

        {/* Buyer and deadline */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {buyer && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" aria-hidden="true" />
              {buyer}
            </span>
          )}
          {deadline && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" aria-hidden="true" />
              {formatDateUK(deadline)}
            </span>
          )}
          {deadlineProximity && (
            <span
              className={cn(
                'inline-flex items-center text-xs font-medium',
                deadlineProximity.isOverdue
                  ? 'text-form-overdue'
                  : 'text-status-warning',
              )}
            >
              {deadlineProximity.label}
            </span>
          )}
        </div>

        {/* Question progress */}
        {totalQuestions > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {completedCount} of {totalQuestions} questions drafted
              </span>
              <span>{progressPercent}%</span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
          </div>
        )}

        {/* Confidence posture breakdown */}
        {postureBreakdown.length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {postureBreakdown.map(({ posture, count }) => (
              <ConfidenceDot key={posture} posture={posture} count={count} />
            ))}
          </div>
        )}

        {/* Claude prompt button */}
        {claudePrompt && (
          <div className="relative z-10 flex justify-end">
            <ClaudePromptButton
              prompt={claudePrompt}
              label="Review with Claude"
              size="sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}
