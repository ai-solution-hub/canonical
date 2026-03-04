'use client';

import { Check, Circle, Clock, Ban } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  BID_STATE_LABELS,
  BID_STATE_COLOURS,
  BID_STATE_PROGRESSION,
  isTerminal,
  type BidState,
} from '@/lib/bid-state-machine';

interface BidStateIndicatorProps {
  state: BidState;
  className?: string;
}

const COLOUR_CLASSES: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  slate: {
    bg: 'bg-slate-100 dark:bg-slate-800',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-300 dark:border-slate-600',
    dot: 'bg-slate-500',
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-300 dark:border-blue-600',
    dot: 'bg-blue-500',
  },
  amber: {
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    text: 'text-amber-700 dark:text-amber-300',
    border: 'border-amber-300 dark:border-amber-600',
    dot: 'bg-amber-500',
  },
  green: {
    bg: 'bg-green-100 dark:bg-green-900/30',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-300 dark:border-green-600',
    dot: 'bg-green-500',
  },
  emerald: {
    bg: 'bg-emerald-100 dark:bg-emerald-900/30',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-600',
    dot: 'bg-emerald-500',
  },
  red: {
    bg: 'bg-red-100 dark:bg-red-900/30',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-300 dark:border-red-600',
    dot: 'bg-red-500',
  },
};

/**
 * Badge showing the current bid state with colour + text (WCAG 2.1 AA).
 */
export function BidStateBadge({ state, className }: BidStateIndicatorProps) {
  const colourKey = BID_STATE_COLOURS[state];
  const colours = COLOUR_CLASSES[colourKey] ?? COLOUR_CLASSES.slate;
  const label = BID_STATE_LABELS[state];

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
      <span className={cn('size-1.5 rounded-full', colours.dot)} aria-hidden="true" />
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
    <div className={cn('flex items-center gap-1', className)} role="list" aria-label="Bid progress">
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
                  'flex size-5 items-center justify-center rounded-full border text-[10px]',
                  isCompleted && 'border-primary bg-primary text-primary-foreground',
                  isCurrent && 'border-primary bg-primary/10 text-primary ring-2 ring-primary/30',
                  isFuture && 'border-muted-foreground/30 text-muted-foreground/50',
                  terminal && !isCurrent && 'border-muted-foreground/30 text-muted-foreground/50',
                )}
                aria-current={isCurrent ? 'step' : undefined}
              >
                {isCompleted ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : isCurrent ? (
                  <Circle className="size-2 fill-current" aria-hidden="true" />
                ) : null}
              </div>
              <span
                className={cn(
                  'hidden text-[9px] leading-tight sm:block',
                  isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
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
          <div className="mx-0.5 h-0.5 w-3 sm:w-6 bg-muted" aria-hidden="true" />
          <div className="flex flex-col items-center gap-0.5">
            <div
              className={cn(
                'flex size-5 items-center justify-center rounded-full border',
                state === 'won' && 'border-emerald-500 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
                state === 'lost' && 'border-red-500 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
                state === 'withdrawn' && 'border-slate-400 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
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
            <span className="hidden text-[9px] font-medium leading-tight sm:block">
              {BID_STATE_LABELS[state]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
