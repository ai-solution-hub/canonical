'use client';

import { Progress } from '@/components/ui/progress';
import type { ReviewProgress } from '@/types/review';

interface ReviewProgressBarProps {
  progress: ReviewProgress;
  className?: string;
}

export function ReviewProgressBar({ progress, className = '' }: ReviewProgressBarProps) {
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
        {progress.skipped > 0 && (
          <span>{progress.skipped} skipped</span>
        )}
      </div>
    </div>
  );
}
