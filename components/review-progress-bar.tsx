'use client';

import { Progress } from '@/components/ui/progress';
import type { ReviewProgress } from '@/types/review';

interface ReviewProgressBarProps {
  progress: ReviewProgress;
  /** When true, shows queue position instead of verified/total */
  isDraft?: boolean;
  /** Current position in the queue (1-indexed), used in draft mode */
  queuePosition?: number;
  /** Total items in the loaded queue, used in draft mode */
  queueLength?: number;
  className?: string;
}

export function ReviewProgressBar({
  progress,
  isDraft = false,
  queuePosition,
  queueLength,
  className = '',
}: ReviewProgressBarProps) {
  // Draft mode: show queue position instead of verified/total
  if (isDraft && queuePosition != null && queueLength != null) {
    const draftPercentage = queueLength > 0
      ? Math.round((queuePosition / queueLength) * 100)
      : 0;

    return (
      <div className={`flex flex-col gap-1.5 ${className}`}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Item{' '}
            <span className="font-medium text-foreground">{queuePosition}</span>
            {' '}of{' '}
            <span className="font-medium text-foreground">{queueLength}</span>
            {' '}drafts
          </span>
          <span className="tabular-nums text-muted-foreground">{draftPercentage}%</span>
        </div>
        <Progress
          value={draftPercentage}
          className="h-3"
          aria-label={`Draft review progress: item ${queuePosition} of ${queueLength}`}
          aria-valuenow={draftPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuetext={`Item ${queuePosition} of ${queueLength} drafts`}
        />
        {progress.sessionReviewed > 0 && (
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Reviewed {progress.sessionReviewed} this session
            </span>
          </div>
        )}
      </div>
    );
  }

  const percentage = progress.total > 0
    ? Math.round((progress.verified / progress.total) * 100)
    : 0;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          <span className="font-medium text-foreground">{progress.verified.toLocaleString('en-GB')}</span>
          {' '}of{' '}
          <span className="font-medium text-foreground">{progress.total.toLocaleString('en-GB')}</span>
          {' '}verified
        </span>
        <span className="tabular-nums text-muted-foreground">{percentage}%</span>
      </div>
      <Progress
        value={percentage}
        className="h-3"
        aria-label={`Review progress: ${progress.verified} of ${progress.total} items verified`}
        aria-valuenow={percentage}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${progress.verified} of ${progress.total} verified (${percentage}%)`}
      />
      <div className="flex gap-3 text-xs text-muted-foreground">
        {progress.sessionReviewed > 0 && (
          <span className="font-medium text-foreground">
            Reviewed {progress.sessionReviewed} this session
          </span>
        )}
        {progress.flagged > 0 && (
          <span>{progress.flagged} flagged</span>
        )}
      </div>
    </div>
  );
}
