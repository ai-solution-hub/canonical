'use client';

import type { ProcurementWorkflowState } from '@/types/procurement';

/**
 * STUB — scaffolded by ID-145 {145.42} (145W-2), FILLED by {145.43}.
 *
 * {145.43} wires the custom Warm Meridian stepper (147-L) into the item page
 * over the {145.18} shape: state stepper/badge over the 10-state machine +
 * deadline/submission_date/issuing_organisation/outcome (PRODUCT §G,
 * ID-145 BI-13), and a state-transition control that offers only valid
 * transitions (BI-18, §G3). This stub renders a minimal placeholder — the
 * props below are the {145.18}/route.ts data + handlers {145.43} needs, so
 * that subtask never has to re-edit `page.tsx` to thread new data in
 * (145W-2 establishes the child-component structure, 145W-3/4/5/7 fill it in
 * parallel — see PLAN.md Wave 3).
 */
export interface ItemWorkflowPanelProps {
  workflowState: ProcurementWorkflowState | null;
  deadline?: string | null;
  submissionDate?: string | null;
  issuingOrganisation?: string | null;
  outcome?: string | null;
  availableTransitions?: ProcurementWorkflowState[];
  onTransition?: (state: ProcurementWorkflowState) => void;
  transitioning?: boolean;
  className?: string;
}

export function ItemWorkflowPanel({
  workflowState,
  className,
}: ItemWorkflowPanelProps) {
  return (
    <div
      data-testid="item-workflow-panel"
      className={className ?? 'rounded-lg border bg-card p-4'}
    >
      <p className="text-sm text-muted-foreground">
        Workflow stepper — current state:{' '}
        <span className="font-medium text-foreground">
          {workflowState ?? 'unknown'}
        </span>
        . ({'{145.43}'} wires the full Warm Meridian stepper here.)
      </p>
    </div>
  );
}
