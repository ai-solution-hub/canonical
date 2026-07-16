'use client';

import { Loader2 } from 'lucide-react';
import { WorkflowStepper } from '@/components/procurement/workflow-stepper';
import { ItemInlineStates } from '@/components/procurement/item-inline-states';
import type { ProcurementWorkflowState } from '@/types/procurement';

/**
 * ID-145 {145.43} — the stepper host: wires the custom Warm Meridian
 * `WorkflowStepper` (ID-147 {147.15}, PRODUCT §G) into the item page over the
 * {145.18} shape. State stepper/badge over the 10-state machine +
 * deadline/submission_date/issuing_organisation/outcome (§G1/§G4, BI-13); the
 * transition control offers only valid next states, refusing an invalid jump
 * with a surfaced reason (§G3, BI-18) — `WorkflowStepper` already implements
 * this via `canTransition`/`getAvailableTransitions`
 * (`lib/domains/procurement/procurement-workflow.ts`), the SAME source of
 * truth the server-side `computeWorkflowTransition` write path is gated on, so
 * this host does not re-derive or re-gate transitions itself.
 *
 * `availableTransitions` mirrors the header toolbar's own `regularTransitions`
 * (which excludes the outcome branch once submitted, since that flow routes
 * through the "Record Outcome" dialog instead) — it is accepted here so
 * `page.tsx` never has to re-thread new props, but deliberately NOT used to
 * gate the stepper: BI-13 requires the full 10-state machine, so the stepper
 * computes its own valid next states straight off `workflowState`.
 */
export interface ItemWorkflowPanelProps {
  workflowState: ProcurementWorkflowState | null;
  deadline?: string | null;
  submissionDate?: string | null;
  issuingOrganisation?: string | null;
  outcome?: 'won' | 'lost' | 'withdrawn' | null;
  availableTransitions?: ProcurementWorkflowState[];
  onTransition?: (state: ProcurementWorkflowState) => void;
  transitioning?: boolean;
  className?: string;
}

export function ItemWorkflowPanel({
  workflowState,
  deadline,
  submissionDate,
  issuingOrganisation,
  outcome,
  onTransition,
  transitioning,
  className,
}: ItemWorkflowPanelProps) {
  const rootClassName = className ?? 'rounded-lg border bg-card p-4';

  // Defensive render for the legacy-shape case (BI-19) — `workflow_state` is
  // typed nullable ({145.18} note) even though `deriveProcurementStatus`
  // defaults live reads to 'draft'; a genuinely absent state renders an
  // honest empty card rather than a stepper anchored on a made-up state.
  if (!workflowState) {
    return (
      <div data-testid="item-workflow-panel" className={rootClassName}>
        <ItemInlineStates
          variant="empty"
          message="Workflow state is not available for this item."
        />
      </div>
    );
  }

  return (
    <div data-testid="item-workflow-panel" className={rootClassName}>
      <WorkflowStepper
        currentState={workflowState}
        onTransition={onTransition}
        deadline={deadline}
        submissionDate={submissionDate}
        issuingOrganisation={issuingOrganisation}
        outcome={outcome}
      />
      {transitioning && (
        <p
          role="status"
          aria-live="polite"
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          Updating workflow state…
        </p>
      )}
    </div>
  );
}
