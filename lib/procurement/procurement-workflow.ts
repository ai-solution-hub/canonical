import type { ProcurementWorkflowState } from '@/types/procurement';
import { PROCUREMENT_WORKFLOW_STATES } from '@/types/procurement';

export { PROCUREMENT_WORKFLOW_STATES };
export type { ProcurementWorkflowState };

export const PROCUREMENT_WORKFLOW_LABELS: Record<ProcurementWorkflowState, string> = {
  draft: 'Draft',
  questions_extracted: 'Questions Extracted',
  matching: 'Matching',
  drafting: 'Drafting',
  in_review: 'In Review',
  ready_for_export: 'Ready for Export',
  submitted: 'Submitted',
  won: 'Won',
  lost: 'Lost',
  withdrawn: 'Withdrawn',
};

/** Abbreviated labels for mobile stepper display */
export const PROCUREMENT_WORKFLOW_SHORT_LABELS: Record<ProcurementWorkflowState, string> = {
  draft: 'Draft',
  questions_extracted: 'Extract',
  matching: 'Match',
  drafting: 'Draft',
  in_review: 'Review',
  ready_for_export: 'Export',
  submitted: 'Submit',
  won: 'Won',
  lost: 'Lost',
  withdrawn: 'Withdrawn',
};

// Semantic token prefixes for bid state colours (map to --color-bid-* CSS tokens)
export const PROCUREMENT_WORKFLOW_COLOURS: Record<ProcurementWorkflowState, string> = {
  draft: 'bid-draft',
  questions_extracted: 'bid-discovery',
  matching: 'bid-discovery',
  drafting: 'bid-active',
  in_review: 'bid-in-review',
  ready_for_export: 'bid-export-ready',
  submitted: 'bid-submitted',
  won: 'bid-won',
  lost: 'bid-lost',
  withdrawn: 'bid-withdrawn',
};

const VALID_TRANSITIONS: Record<ProcurementWorkflowState, ProcurementWorkflowState[]> = {
  draft: ['questions_extracted', 'withdrawn'],
  questions_extracted: ['matching', 'withdrawn'],
  matching: ['drafting', 'withdrawn'],
  drafting: ['in_review', 'withdrawn'],
  in_review: ['ready_for_export', 'drafting', 'withdrawn'],
  ready_for_export: ['submitted', 'in_review', 'withdrawn'],
  submitted: ['won', 'lost', 'in_review', 'withdrawn'],
  won: [],
  lost: [],
  withdrawn: [],
};

export function canTransition(from: ProcurementWorkflowState, to: ProcurementWorkflowState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAvailableTransitions(current: ProcurementWorkflowState): ProcurementWorkflowState[] {
  return VALID_TRANSITIONS[current] ?? [];
}

export function isTerminal(state: ProcurementWorkflowState): boolean {
  return ['won', 'lost', 'withdrawn'].includes(state);
}

export function isActive(state: ProcurementWorkflowState): boolean {
  return !isTerminal(state);
}

// Linear progression states for the stepper display (excludes terminal branches)
export const PROCUREMENT_WORKFLOW_PROGRESSION: ProcurementWorkflowState[] = [
  'draft',
  'questions_extracted',
  'matching',
  'drafting',
  'in_review',
  'ready_for_export',
  'submitted',
];
