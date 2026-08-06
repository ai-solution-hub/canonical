'use client';

import { cn } from '@/lib/utils';
import {
  CONFIDENCE_POSTURE_CONFIG,
  type ConfidencePosture,
} from '@/types/procurement';

const DOT_CLASSES: Record<ConfidencePosture, string> = {
  strong_match: 'bg-confidence-strong',
  partial_match: 'bg-confidence-partial',
  needs_sme: 'bg-confidence-needs-sme',
  no_content: 'bg-confidence-none',
};

/**
 * Small coloured dot for confidence posture (used in summary breakdowns).
 */
export function ConfidenceDot({
  posture,
  count,
  className,
}: {
  posture: ConfidencePosture;
  count: number;
  className?: string;
}) {
  const config = CONFIDENCE_POSTURE_CONFIG[posture];
  const dotClass = DOT_CLASSES[posture];

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
      <span
        className={cn('size-2 rounded-full', dotClass)}
        aria-hidden="true"
      />
      <span className="text-muted-foreground">
        {config.label}: {count}
      </span>
    </span>
  );
}
