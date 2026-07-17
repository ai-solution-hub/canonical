'use client';

import { Loader2, Lock } from 'lucide-react';
import { WorkflowStepper } from '@/components/procurement/workflow-stepper';
import { ItemInlineStates } from '@/components/procurement/item-inline-states';
import { cn } from '@/lib/utils';
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
 * ID-145 {145.50} — `canEdit` (threaded from `useUserRole()` via page.tsx,
 * the SAME viewer/editor signal every sibling panel — `ItemQuestionsPanel`,
 * `ItemCoveragePanel`, `ItemDocumentsTab` — gates on) controls whether the
 * stepper is interactive. Non-editor/viewer roles get a visibly-labelled,
 * `inert` (unfocusable, unclickable) stepper instead of relying solely on
 * the server-side transition gate (BI-47) — presentation-layer only, that
 * gate is untouched. `onTransition` is also withheld when `!canEdit` as a
 * second, independent line of defence, and the wrapper carries
 * `aria-disabled` for assistive tech that doesn't yet honour `inert`.
 */
export interface ItemWorkflowPanelProps {
  workflowState: ProcurementWorkflowState | null;
  deadline?: string | null;
  submissionDate?: string | null;
  issuingOrganisation?: string | null;
  outcome?: 'won' | 'lost' | 'withdrawn' | null;
  /** Viewer/editor signal (`useUserRole().canEdit`) — non-editors get a read-only stepper. */
  canEdit: boolean;
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
  canEdit,
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
      {!canEdit && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden="true" />
          View only — you don&apos;t have permission to change this bid&apos;s
          workflow state.
        </p>
      )}
      <div
        data-testid="workflow-stepper-wrapper"
        inert={!canEdit}
        aria-disabled={!canEdit}
        className={cn(!canEdit && 'pointer-events-none opacity-60')}
      >
        <WorkflowStepper
          currentState={workflowState}
          onTransition={canEdit ? onTransition : undefined}
          deadline={deadline}
          submissionDate={submissionDate}
          issuingOrganisation={issuingOrganisation}
          outcome={outcome}
        />
      </div>
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
