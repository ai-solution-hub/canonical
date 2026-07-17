'use client';

/**
 * Workflow-state BADGE for procurement list/detail surfaces.
 *
 * The read-only `ProcurementWorkflowStepper` that used to live alongside the
 * badge was superseded by the interactive 10-state `WorkflowStepper`
 * (`components/procurement/workflow-stepper.tsx`, ID-147 {147.15}, wired via
 * `item-workflow-panel.tsx`) and removed in the S482 orphan sweep — it had
 * zero importers.
 */

import { cn } from '@/lib/utils';
import {
  PROCUREMENT_WORKFLOW_LABELS,
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
