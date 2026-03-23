'use client';

import { cn } from '@/lib/utils';

interface GuideProgressBarProps {
  populated: number;
  total: number;
  className?: string;
}

export function GuideProgressBar({ populated, total, className }: GuideProgressBarProps) {
  const percentage = total > 0 ? Math.round((populated / total) * 100) : 0;
  const isComplete = populated >= total;

  return (
    <div className={cn('rounded-lg border border-border bg-card p-3', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">
          Coverage: {populated}/{total} required sections populated
        </span>
        <span
          className={cn(
            'font-semibold',
            isComplete ? 'text-freshness-fresh' : 'text-muted-foreground',
          )}
        >
          {percentage}%
        </span>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={populated}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`Guide coverage: ${populated} of ${total} required sections populated`}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isComplete ? 'bg-freshness-fresh' : 'bg-primary',
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
