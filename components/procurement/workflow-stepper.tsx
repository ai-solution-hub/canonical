'use client';

import { useState } from 'react';
import {
  Check,
  Circle,
  Trophy,
  XCircle,
  MinusCircle,
  Calendar,
  Building2,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDateUK } from '@/lib/format';
import { getDeadlineProximity } from '@/lib/domains/procurement/procurement-helpers';
import {
  PROCUREMENT_WORKFLOW_LABELS,
  PROCUREMENT_WORKFLOW_STATES,
  canTransition,
  getAvailableTransitions,
  isTerminal,
  type ProcurementWorkflowState,
} from '@/lib/domains/procurement/procurement-workflow';

// ID-147 {147.15} — custom Warm Meridian workflow-state stepper (DR-067: NOT
// the AI-SDK Elements `workflow` graph canvas). Presentational + reusable:
// this component does not call the transition API itself — it READS THROUGH
// `canTransition`/`getAvailableTransitions` (lib/domains/procurement/procurement-workflow.ts,
// the same source of truth `computeWorkflowTransition`, app/api/procurement/[id]/route.ts:77-134,
// is gated on) to decide which next states are offered, and reports an
// attempted transition to the caller via `onTransition`. The consolidated
// transition WRITE (submission_date/outcome/audit stamping) stays
// server-side; this component is not a re-implementation of it.

type TerminalOutcome = 'won' | 'lost' | 'withdrawn';

const TERMINAL_ICONS: Record<TerminalOutcome, typeof Trophy> = {
  won: Trophy,
  lost: XCircle,
  withdrawn: MinusCircle,
};

const TERMINAL_TOKENS: Record<
  TerminalOutcome,
  { text: string; bg: string; border: string }
> = {
  won: {
    text: 'text-form-won',
    bg: 'bg-form-won-bg',
    border: 'border-form-won-border',
  },
  lost: {
    text: 'text-form-lost',
    bg: 'bg-form-lost-bg',
    border: 'border-form-lost-border',
  },
  withdrawn: {
    text: 'text-form-withdrawn',
    bg: 'bg-form-withdrawn-bg',
    border: 'border-form-withdrawn-border',
  },
};

function isTerminalOutcome(
  state: ProcurementWorkflowState,
): state is TerminalOutcome {
  return state === 'won' || state === 'lost' || state === 'withdrawn';
}

/** Human-readable, non-technical reason for a refused jump (§G3). */
function describeRefusal(
  from: ProcurementWorkflowState,
  to: ProcurementWorkflowState,
): string {
  const fromLabel = PROCUREMENT_WORKFLOW_LABELS[from];
  const toLabel = PROCUREMENT_WORKFLOW_LABELS[to];
  const validNext = getAvailableTransitions(from).map(
    (state) => PROCUREMENT_WORKFLOW_LABELS[state],
  );

  if (validNext.length === 0) {
    return `"${fromLabel}" is a final state — no further transitions are available.`;
  }

  return `Cannot move directly from "${fromLabel}" to "${toLabel}". Valid next states: ${validNext.join(', ')}.`;
}

export interface WorkflowStepperProps {
  /** Current `workflow_state` (one of the 10 states, ID-145 BI-13). */
  currentState: ProcurementWorkflowState;
  /**
   * Called with a `canTransition`-valid target when the user selects it.
   * Omit for a read-only display (the stepper still surfaces refusal
   * reasons for invalid clicks, it just has nothing to invoke on success).
   */
  onTransition?: (target: ProcurementWorkflowState) => void;
  deadline?: string | null;
  submissionDate?: string | null;
  issuingOrganisation?: string | null;
  /** Terminal outcome — distinct from `workflow_state` (cleared on withdrawal). */
  outcome?: TerminalOutcome | null;
  className?: string;
}

/**
 * Custom Warm Meridian stepper over the 10-state procurement `workflow_state`
 * machine. Renders every state in fixed linear order with a distinct
 * current-state badge (§G1); completed/current/upcoming each carry a text
 * label and icon, never colour alone (§G2); clicking a state attempts a
 * transition — valid targets call `onTransition`, invalid ones are refused
 * with a surfaced, readable reason rather than a silent no-op (§G3);
 * deadline/submission/issuing-organisation/outcome are shown alongside with
 * a text label or icon, never colour alone (§G4).
 */
export function WorkflowStepper({
  currentState,
  onTransition,
  deadline = null,
  submissionDate = null,
  issuingOrganisation = null,
  outcome = null,
  className,
}: WorkflowStepperProps) {
  const [refusalReason, setRefusalReason] = useState<string | null>(null);

  const terminal = isTerminal(currentState);
  const currentIndex = PROCUREMENT_WORKFLOW_STATES.indexOf(currentState);
  const validNextStates = getAvailableTransitions(currentState);
  const deadlineProximity = getDeadlineProximity(deadline);

  function attemptTransition(target: ProcurementWorkflowState) {
    if (target === currentState) {
      return;
    }
    if (!canTransition(currentState, target)) {
      setRefusalReason(describeRefusal(currentState, target));
      return;
    }
    setRefusalReason(null);
    onTransition?.(target);
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Current-state badge (§G1) — distinctly marked, badge + label, never colour-only. */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">
          Current state:
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
            terminal && isTerminalOutcome(currentState)
              ? cn(
                  TERMINAL_TOKENS[currentState].bg,
                  TERMINAL_TOKENS[currentState].text,
                  TERMINAL_TOKENS[currentState].border,
                )
              : 'border-primary/40 bg-primary/10 text-primary',
          )}
        >
          {terminal && isTerminalOutcome(currentState)
            ? (() => {
                const Icon = TERMINAL_ICONS[currentState];
                return <Icon className="size-3" aria-hidden="true" />;
              })()
            : null}
          {PROCUREMENT_WORKFLOW_LABELS[currentState]}
        </span>
      </div>

      {/* Linear ordered stepper over all 10 states (§G1). */}
      <div
        className="flex flex-wrap items-center gap-1"
        role="list"
        aria-label="Workflow state progress"
      >
        {PROCUREMENT_WORKFLOW_STATES.map((step, index) => {
          const isCurrent = step === currentState;
          const isCompleted = !terminal && !isCurrent && currentIndex > index;
          const isValidTarget = !isCurrent && validNextStates.includes(step);
          const StepIcon = isTerminalOutcome(step)
            ? TERMINAL_ICONS[step]
            : isCompleted
              ? Check
              : Circle;

          return (
            <div key={step} className="flex items-center" role="listitem">
              {index > 0 && (
                <span
                  className={cn(
                    'mx-0.5 h-px w-3 sm:w-5',
                    isCompleted ? 'bg-primary' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => attemptTransition(step)}
                aria-current={isCurrent ? 'step' : undefined}
                title={
                  isValidTarget
                    ? `Move to ${PROCUREMENT_WORKFLOW_LABELS[step]}`
                    : isCurrent
                      ? undefined
                      : describeRefusal(currentState, step)
                }
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium leading-none transition-colors',
                  isCompleted &&
                    'border-primary bg-primary text-primary-foreground',
                  isCurrent &&
                    !isTerminalOutcome(step) &&
                    'border-primary bg-primary/10 text-primary ring-2 ring-primary/30',
                  isCurrent &&
                    isTerminalOutcome(step) &&
                    cn(
                      TERMINAL_TOKENS[step].bg,
                      TERMINAL_TOKENS[step].text,
                      TERMINAL_TOKENS[step].border,
                      'ring-2 ring-primary/30',
                    ),
                  !isCompleted &&
                    !isCurrent &&
                    'border-muted-foreground/30 text-muted-foreground',
                  isValidTarget && 'cursor-pointer hover:border-primary/60',
                )}
              >
                <StepIcon
                  className={cn(
                    'size-3',
                    isCurrent && !isCompleted && 'fill-current',
                  )}
                  aria-hidden="true"
                />
                {PROCUREMENT_WORKFLOW_LABELS[step]}
              </button>
            </div>
          );
        })}
      </div>

      {/* Transition control (§G3) — only canTransition-valid next states are offered. */}
      {validNextStates.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Available next states:{' '}
          {validNextStates
            .map((state) => PROCUREMENT_WORKFLOW_LABELS[state])
            .join(', ')}
          .
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {PROCUREMENT_WORKFLOW_LABELS[currentState]} is a final state — no
          further transitions are available.
        </p>
      )}

      {/* Refused-jump reason (§G3) — surfaced, readable, never a silent no-op. */}
      {refusalReason && (
        <p className="text-sm text-destructive" role="alert">
          {refusalReason}
        </p>
      )}

      {/* Deadline / submission / issuing organisation / outcome (§G4) — text label or icon, never colour alone. */}
      {(deadline || submissionDate || issuingOrganisation || outcome) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {deadline && (
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="size-3.5" aria-hidden="true" />
              Deadline: {formatDateUK(deadline)}
              {deadlineProximity && (
                <span
                  className={cn(
                    'font-medium',
                    deadlineProximity.isOverdue
                      ? 'text-form-overdue'
                      : 'text-status-warning',
                  )}
                >
                  ({deadlineProximity.label})
                </span>
              )}
            </span>
          )}
          {submissionDate && (
            <span className="inline-flex items-center gap-1.5">
              <Send className="size-3.5" aria-hidden="true" />
              Submitted: {formatDateUK(submissionDate)}
            </span>
          )}
          {issuingOrganisation && (
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="size-3.5" aria-hidden="true" />
              Issuing organisation: {issuingOrganisation}
            </span>
          )}
          {outcome && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-medium',
                TERMINAL_TOKENS[outcome].text,
              )}
            >
              {(() => {
                const Icon = TERMINAL_ICONS[outcome];
                return <Icon className="size-3.5" aria-hidden="true" />;
              })()}
              Outcome: {PROCUREMENT_WORKFLOW_LABELS[outcome]}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
