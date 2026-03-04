'use client';

import { CheckCircle, AlertCircle, User, FileQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CONFIDENCE_POSTURE_CONFIG, type ConfidencePosture } from '@/types/bid';

interface ConfidenceBadgeProps {
  posture: ConfidencePosture;
  compact?: boolean;
  className?: string;
}

const ICON_MAP = {
  'check-circle': CheckCircle,
  'alert-circle': AlertCircle,
  'user': User,
  'file-question': FileQuestion,
} as const;

const COLOUR_CLASSES: Record<string, { bg: string; text: string; border: string }> = {
  green: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-300 dark:border-green-600',
  },
  amber: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-600',
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-300 dark:border-blue-600',
  },
  slate: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-600 dark:text-slate-400',
    border: 'border-slate-300 dark:border-slate-600',
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
export function ConfidenceBadge({ posture, compact = false, className }: ConfidenceBadgeProps) {
  const config = CONFIDENCE_POSTURE_CONFIG[posture];
  const colours = COLOUR_CLASSES[config.colour] ?? COLOUR_CLASSES.slate;
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
  const colours = COLOUR_CLASSES[config.colour] ?? COLOUR_CLASSES.slate;

  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', className)}>
      <span className={cn('size-2 rounded-full', colours.text.replaceAll('text-', 'bg-'))} aria-hidden="true" />
      <span className="text-muted-foreground">
        {config.label}: {count}
      </span>
    </span>
  );
}
