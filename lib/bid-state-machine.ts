import type { BidState } from '@/types/bid';
import { BID_STATES } from '@/types/bid';

export { BID_STATES };
export type { BidState };

export const BID_STATE_LABELS: Record<BidState, string> = {
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

// Semantic token prefixes for bid state colours (map to --color-bid-* CSS tokens)
export const BID_STATE_COLOURS: Record<BidState, string> = {
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

const VALID_TRANSITIONS: Record<BidState, BidState[]> = {
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

export function canTransition(from: BidState, to: BidState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function getAvailableTransitions(current: BidState): BidState[] {
  return VALID_TRANSITIONS[current] ?? [];
}

export function isTerminal(state: BidState): boolean {
  return ['won', 'lost', 'withdrawn'].includes(state);
}

export function isActive(state: BidState): boolean {
  return !isTerminal(state);
}

// Linear progression states for the stepper display (excludes terminal branches)
export const BID_STATE_PROGRESSION: BidState[] = [
  'draft', 'questions_extracted', 'matching', 'drafting',
  'in_review', 'ready_for_export', 'submitted',
];
