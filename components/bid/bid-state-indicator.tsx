'use client';

import { Check, Circle, Clock, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BID_STATE_LABELS,
  BID_STATE_SHORT_LABELS,
  BID_STATE_PROGRESSION,
  isTerminal,
  type BidState,
} from '@/lib/bid/bid-state-machine';

interface BidStateIndicatorProps {
  state: BidState;
  className?: string;
}

const COLOUR_CLASSES: Record<
  BidState,
  { bg: string; text: string; border: string; dot: string }
> = {
  draft: {
    bg: 'bg-bid-draft-bg',
    text: 'text-bid-draft',
    border: 'border-bid-draft-border',
    dot: 'bg-bid-draft-dot',
  },
  questions_extracted: {
    bg: 'bg-bid-discovery-bg',
    text: 'text-bid-discovery',
    border: 'border-bid-discovery-border',
    dot: 'bg-bid-discovery-dot',
  },
  matching: {
    bg: 'bg-bid-discovery-bg',
    text: 'text-bid-discovery',
    border: 'border-bid-discovery-border',
    dot: 'bg-bid-discovery-dot',
  },
  drafting: {
    bg: 'bg-bid-active-bg',
    text: 'text-bid-active',
    border: 'border-bid-active-border',
    dot: 'bg-bid-active-dot',
  },
  in_review: {
    bg: 'bg-bid-in-review-bg',
    text: 'text-bid-in-review',
    border: 'border-bid-in-review-border',
    dot: 'bg-bid-in-review-dot',
  },
  ready_for_export: {
    bg: 'bg-bid-export-ready-bg',
    text: 'text-bid-export-ready',
    border: 'border-bid-export-ready-border',
    dot: 'bg-bid-export-ready-dot',
  },
  submitted: {
    bg: 'bg-bid-submitted-bg',
    text: 'text-bid-submitted',
    border: 'border-bid-submitted-border',
    dot: 'bg-bid-submitted-dot',
  },
  won: {
    bg: 'bg-bid-won-bg',
    text: 'text-bid-won',
    border: 'border-bid-won-border',
    dot: 'bg-bid-won',
  },
  lost: {
    bg: 'bg-bid-lost-bg',
    text: 'text-bid-lost',
    border: 'border-bid-lost-border',
    dot: 'bg-bid-lost',
  },
  withdrawn: {
    bg: 'bg-bid-withdrawn-bg',
    text: 'text-bid-withdrawn',
    border: 'border-bid-withdrawn-border',
    dot: 'bg-bid-withdrawn',
  },
};

/**
 * Badge showing the current bid state with colour + text (WCAG 2.1 AA).
 */
export function BidStateBadge({ state, className }: BidStateIndicatorProps) {
  const colours = COLOUR_CLASSES[state] ?? COLOUR_CLASSES.draft;
  const label = BID_STATE_LABELS[state] ?? 'Unknown';

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
export function BidStateStepper({ state, className }: BidStateIndicatorProps) {
  const currentIndex = BID_STATE_PROGRESSION.indexOf(state);
  const terminal = isTerminal(state);

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      role="list"
      aria-label="Bid progress"
    >
      {BID_STATE_PROGRESSION.map((step, index) => {
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
                {BID_STATE_SHORT_LABELS[step]}
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
                {BID_STATE_LABELS[step]}
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
                  'border-bid-won-border bg-bid-won-bg text-bid-won',
                state === 'lost' &&
                  'border-bid-lost-border bg-bid-lost-bg text-bid-lost',
                state === 'withdrawn' &&
                  'border-bid-withdrawn-border bg-bid-withdrawn-bg text-bid-withdrawn',
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
              {BID_STATE_SHORT_LABELS[state]}
            </span>
            {/* Full label on desktop */}
            <span className="hidden text-[11px] font-medium leading-tight sm:block">
              {BID_STATE_LABELS[state]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
