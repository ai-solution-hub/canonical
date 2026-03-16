'use client';

import Link from 'next/link';
import { Calendar, Building2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { BidStateBadge } from '@/components/bid-state-indicator';
import { ConfidenceDot } from '@/components/confidence-badge';
import { formatDateUK } from '@/lib/format';
import { getDeadlineProximity } from '@/lib/bid-helpers';
import { cn } from '@/lib/utils';
import type { Bid, BidMetadata, ConfidencePosture } from '@/types/bid';
import type { BidState } from '@/types/bid';

/**
 * Maps each BidState to a left-border accent class using semantic bid-* tokens.
 * Classes must be written out fully for Tailwind's JIT scanner to detect them.
 */
const STATUS_BORDER_CLASS: Record<BidState, string> = {
  draft: 'border-l-bid-draft-border',
  questions_extracted: 'border-l-bid-discovery-border',
  matching: 'border-l-bid-discovery-border',
  drafting: 'border-l-bid-active-border',
  in_review: 'border-l-bid-in-review-border',
  ready_for_export: 'border-l-bid-export-ready-border',
  submitted: 'border-l-bid-submitted-border',
  won: 'border-l-bid-won-border',
  lost: 'border-l-bid-lost-border',
  withdrawn: 'border-l-bid-withdrawn-border',
};

interface BidListCardProps {
  bid: Bid;
  className?: string;
}

export function BidListCard({ bid, className }: BidListCardProps) {
  const metadata = bid.domain_metadata as BidMetadata;
  const bidStatus = (bid.status ?? metadata.status) as BidMetadata['status'];
  const stats = bid.question_stats;
  const totalQuestions = stats?.total_questions ?? 0;
  const completedCount = (stats?.drafted_count ?? 0) + (stats?.complete_count ?? 0);
  const progressPercent = totalQuestions > 0 ? Math.round((completedCount / totalQuestions) * 100) : 0;

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
  const deadlineProximity = getDeadlineProximity(metadata.deadline);

  return (
    <Link
      href={`/bid/${bid.id}`}
      className={cn(
        'group block rounded-lg border border-l-4 bg-card text-card-foreground shadow-sm transition-all hover:shadow-md hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 outline-none',
        STATUS_BORDER_CLASS[bidStatus] ?? 'border-l-bid-draft-border',
        className,
      )}
    >
      <div className="flex flex-col gap-3 p-4">
        {/* Header: name + status */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-base font-semibold leading-tight text-foreground group-hover:underline decoration-muted-foreground/40 transition-colors">
            {bid.name}
          </h3>
          <BidStateBadge state={bidStatus} className="shrink-0" />
        </div>

        {/* Buyer and deadline */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {metadata.buyer && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" aria-hidden="true" />
              {metadata.buyer}
            </span>
          )}
          {metadata.deadline && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" aria-hidden="true" />
              {formatDateUK(metadata.deadline)}
            </span>
          )}
          {deadlineProximity && (
            <span
              className={cn(
                'inline-flex items-center text-xs font-medium',
                deadlineProximity.isOverdue
                  ? 'text-bid-overdue'
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
      </div>
    </Link>
  );
}
