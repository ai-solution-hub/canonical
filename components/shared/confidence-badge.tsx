'use client';

import { CheckCircle, AlertCircle, User, FileQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONFIDENCE_POSTURE_CONFIG, type ConfidencePosture } from '@/types/procurement';

interface ConfidenceBadgeProps {
  posture: ConfidencePosture;
  compact?: boolean;
  className?: string;
}

const ICON_MAP = {
  'check-circle': CheckCircle,
  'alert-circle': AlertCircle,
  user: User,
  'file-question': FileQuestion,
} as const;

const COLOUR_CLASSES: Record<
  ConfidencePosture,
  { bg: string; text: string; border: string; dot: string }
> = {
  strong_match: {
    bg: 'bg-confidence-strong-bg',
    text: 'text-confidence-strong',
    border: 'border-confidence-strong-border',
    dot: 'bg-confidence-strong',
  },
  partial_match: {
    bg: 'bg-confidence-partial-bg',
    text: 'text-confidence-partial',
    border: 'border-confidence-partial-border',
    dot: 'bg-confidence-partial',
  },
  needs_sme: {
    bg: 'bg-confidence-needs-sme-bg',
    text: 'text-confidence-needs-sme',
    border: 'border-confidence-needs-sme-border',
    dot: 'bg-confidence-needs-sme',
  },
  no_content: {
    bg: 'bg-confidence-none-bg',
    text: 'text-confidence-none',
    border: 'border-confidence-none-border',
    dot: 'bg-confidence-none',
  },
};

// Short labels for compact display
const SHORT_LABELS: Record<ConfidencePosture, string> = {
  strong_match: 'SM',
  partial_match: 'PM',
  needs_sme: 'NS',
  no_content: 'NC',
};

/**
 * Confidence posture badge using colour + icon + text (WCAG 2.1 AA -- never colour alone).
 */
export function ConfidenceBadge({
  posture,
  compact = false,
  className,
}: ConfidenceBadgeProps) {
  const config = CONFIDENCE_POSTURE_CONFIG[posture];
  const colours = COLOUR_CLASSES[posture];
  const Icon = ICON_MAP[config.icon as keyof typeof ICON_MAP] ?? FileQuestion;

  if (compact) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium',
          colours.text,
          className,
        )}
        title={`${config.label}: ${config.description}`}
      >
        <Icon className="size-3" aria-hidden="true" />
        <span>{SHORT_LABELS[posture]}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        colours.bg,
        colours.text,
        colours.border,
        className,
      )}
      title={config.description}
    >
      <Icon className="size-3" aria-hidden="true" />
      {config.label}
    </span>
  );
}

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
  const colours = COLOUR_CLASSES[posture];

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
      <span
        className={cn('size-2 rounded-full', colours.dot)}
        aria-hidden="true"
      />
      <span className="text-muted-foreground">
        {config.label}: {count}
      </span>
    </span>
  );
}
