'use client';

import { Check, Circle, Clock, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PROCUREMENT_WORKFLOW_LABELS,
  PROCUREMENT_WORKFLOW_SHORT_LABELS,
  PROCUREMENT_WORKFLOW_PROGRESSION,
  isTerminal,
  type ProcurementWorkflowState,
} from '@/lib/domains/procurement/procurement-workflow';

interface ProcurementWorkflowIndicatorProps {
  state: ProcurementWorkflowState;
  className?: string;
}

const COLOUR_CLASSES: Record<
  ProcurementWorkflowState,
  { bg: string; text: string; border: string; dot: string }
> = {
  draft: {
    bg: 'bg-form-draft-bg',
    text: 'text-form-draft',
    border: 'border-form-draft-border',
    dot: 'bg-form-draft-dot',
  },
  questions_extracted: {
    bg: 'bg-form-discovery-bg',
    text: 'text-form-discovery',
    border: 'border-form-discovery-border',
    dot: 'bg-form-discovery-dot',
  },
  matching: {
    bg: 'bg-form-discovery-bg',
    text: 'text-form-discovery',
    border: 'border-form-discovery-border',
    dot: 'bg-form-discovery-dot',
  },
  drafting: {
    bg: 'bg-form-active-bg',
    text: 'text-form-active',
    border: 'border-form-active-border',
    dot: 'bg-form-active-dot',
  },
  in_review: {
    bg: 'bg-form-in-review-bg',
    text: 'text-form-in-review',
    border: 'border-form-in-review-border',
    dot: 'bg-form-in-review-dot',
  },
  ready_for_export: {
    bg: 'bg-form-export-ready-bg',
    text: 'text-form-export-ready',
    border: 'border-form-export-ready-border',
    dot: 'bg-form-export-ready-dot',
  },
  submitted: {
    bg: 'bg-form-submitted-bg',
    text: 'text-form-submitted',
    border: 'border-form-submitted-border',
    dot: 'bg-form-submitted-dot',
  },
  won: {
    bg: 'bg-form-won-bg',
    text: 'text-form-won',
    border: 'border-form-won-border',
    dot: 'bg-form-won',
  },
  lost: {
    bg: 'bg-form-lost-bg',
    text: 'text-form-lost',
    border: 'border-form-lost-border',
    dot: 'bg-form-lost',
  },
  withdrawn: {
    bg: 'bg-form-withdrawn-bg',
    text: 'text-form-withdrawn',
    border: 'border-form-withdrawn-border',
    dot: 'bg-form-withdrawn',
  },
};

/**
 * Badge showing the current bid state with colour + text (WCAG 2.1 AA).
 */
export function ProcurementWorkflowBadge({
  state,
  className,
}: ProcurementWorkflowIndicatorProps) {
  const colours = COLOUR_CLASSES[state] ?? COLOUR_CLASSES.draft;
  const label = PROCUREMENT_WORKFLOW_LABELS[state] ?? 'Unknown';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        colours.bg,
        colours.text,
        colours.border,
        className,
      )}
    >
      <span
        className={cn('size-1.5 rounded-full', colours.dot)}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

/**
 * Horizontal stepper showing bid progress through lifecycle states.
 */
export function ProcurementWorkflowStepper({
  state,
  className,
}: ProcurementWorkflowIndicatorProps) {
  const currentIndex = PROCUREMENT_WORKFLOW_PROGRESSION.indexOf(state);
  const terminal = isTerminal(state);

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      role="list"
      aria-label="Procurement progress"
    >
      {PROCUREMENT_WORKFLOW_PROGRESSION.map((step, index) => {
        const isCompleted = !terminal && currentIndex > index;
        const isCurrent = step === state;
        const isFuture = !terminal && currentIndex < index;

        return (
          <div key={step} className="flex items-center" role="listitem">
            {index > 0 && (
              <div
                className={cn(
                  'mx-0.5 h-0.5 w-3 sm:w-6',
                  isCompleted ? 'bg-primary' : 'bg-muted',
                )}
                aria-hidden="true"
              />
            )}
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border text-xs',
                  isCompleted &&
                    'border-primary bg-primary text-primary-foreground',
                  isCurrent &&
                    'border-primary bg-primary/10 text-primary ring-2 ring-primary/30',
                  isFuture &&
                    'border-muted-foreground/30 text-muted-foreground/50',
                  terminal &&
                    !isCurrent &&
                    'border-muted-foreground/30 text-muted-foreground/50',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isCompleted ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : isCurrent ? (
                  <Circle className="size-2 fill-current" aria-hidden="true" />
                ) : null}
              </div>
              {/* Abbreviated label on mobile */}
              <span
                className={cn(
                  'block text-[9px] leading-tight sm:hidden',
                  isCurrent
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
                aria-hidden="true"
              >
                {PROCUREMENT_WORKFLOW_SHORT_LABELS[step]}
              </span>
              {/* Full label on desktop */}
              <span
                className={cn(
                  'hidden text-[11px] leading-tight sm:block',
                  isCurrent
                    ? 'font-medium text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {PROCUREMENT_WORKFLOW_LABELS[step]}
              </span>
            </div>
          </div>
        );
      })}

      {/* Terminal state indicator */}
      {terminal && (
        <div className="flex items-center" role="listitem">
          <div
            className="mx-0.5 h-0.5 w-3 sm:w-6 bg-muted"
            aria-hidden="true"
          />
          <div className="flex flex-col items-center gap-0.5">
            <div
              className={cn(
                'flex size-5 items-center justify-center rounded-full border',
                state === 'won' &&
                  'border-form-won-border bg-form-won-bg text-form-won',
                state === 'lost' &&
                  'border-form-lost-border bg-form-lost-bg text-form-lost',
                state === 'withdrawn' &&
                  'border-form-withdrawn-border bg-form-withdrawn-bg text-form-withdrawn',
              )}
              aria-current="step"
            >
              {state === 'won' ? (
                <Check className="size-3" aria-hidden="true" />
              ) : state === 'lost' ? (
                <Ban className="size-3" aria-hidden="true" />
              ) : (
                <Clock className="size-3" aria-hidden="true" />
              )}
            </div>
            {/* Abbreviated label on mobile */}
            <span
              className="block text-[9px] font-medium leading-tight sm:hidden"
              aria-hidden="true"
            >
              {PROCUREMENT_WORKFLOW_SHORT_LABELS[state]}
            </span>
            {/* Full label on desktop */}
            <span className="hidden text-[11px] font-medium leading-tight sm:block">
              {PROCUREMENT_WORKFLOW_LABELS[state]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
