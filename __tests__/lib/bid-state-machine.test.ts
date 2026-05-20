import { describe, it, expect } from 'vitest';
import {
  canTransition,
  getAvailableTransitions,
  isTerminal,
  isActive,
  BID_STATES,
  BID_STATE_LABELS,
  BID_STATE_COLOURS,
  BID_STATE_PROGRESSION,
  type BidState,
} from '@/lib/procurement/procurement-workflow';

describe('bid-state-machine', () => {
  describe('BID_STATES', () => {
    it('contains 10 states', () => {
      expect(BID_STATES).toHaveLength(10);
    });

    it('every state has a label', () => {
      for (const state of BID_STATES) {
        expect(BID_STATE_LABELS[state]).toBeTruthy();
      }
    });

    it('every state has a colour', () => {
      for (const state of BID_STATES) {
        expect(BID_STATE_COLOURS[state]).toBeTruthy();
      }
    });
  });

  describe('canTransition', () => {
    // Forward transitions (happy path)
    const validForwardTransitions: [BidState, BidState][] = [
      ['draft', 'questions_extracted'],
      ['questions_extracted', 'matching'],
      ['matching', 'drafting'],
      ['drafting', 'in_review'],
      ['in_review', 'ready_for_export'],
      ['ready_for_export', 'submitted'],
      ['submitted', 'won'],
      ['submitted', 'lost'],
    ];

    it.each(validForwardTransitions)(
      'allows forward transition from %s to %s',
      (from, to) => {
        expect(canTransition(from, to)).toBe(true);
      },
    );

    // Backward transitions
    const validBackwardTransitions: [BidState, BidState][] = [
      ['in_review', 'drafting'],
      ['ready_for_export', 'in_review'],
      ['submitted', 'in_review'],
    ];

    it.each(validBackwardTransitions)(
      'allows backward transition from %s to %s',
      (from, to) => {
        expect(canTransition(from, to)).toBe(true);
      },
    );

    // Withdrawal from any active state
    const activeStates: BidState[] = [
      'draft',
      'questions_extracted',
      'matching',
      'drafting',
      'in_review',
      'ready_for_export',
      'submitted',
    ];

    it.each(activeStates)('allows withdrawal from %s', (state) => {
      expect(canTransition(state, 'withdrawn')).toBe(true);
    });

    // Invalid transitions
    const invalidTransitions: [BidState, BidState][] = [
      ['draft', 'drafting'], // Skipping states
      ['draft', 'submitted'], // Skipping many states
      ['won', 'draft'], // From terminal
      ['lost', 'draft'], // From terminal
      ['withdrawn', 'draft'], // From terminal
      ['matching', 'draft'], // Going backward (not allowed)
      ['drafting', 'matching'], // Going backward (not allowed)
    ];

    it.each(invalidTransitions)(
      'rejects invalid transition from %s to %s',
      (from, to) => {
        expect(canTransition(from, to)).toBe(false);
      },
    );
  });

  describe('getAvailableTransitions', () => {
    it('returns expected transitions for draft', () => {
      const transitions = getAvailableTransitions('draft');
      expect(transitions).toContain('questions_extracted');
      expect(transitions).toContain('withdrawn');
      expect(transitions).toHaveLength(2);
    });

    it('returns no transitions for terminal states', () => {
      expect(getAvailableTransitions('won')).toEqual([]);
      expect(getAvailableTransitions('lost')).toEqual([]);
      expect(getAvailableTransitions('withdrawn')).toEqual([]);
    });

    it('returns multiple options for in_review', () => {
      const transitions = getAvailableTransitions('in_review');
      expect(transitions).toContain('ready_for_export');
      expect(transitions).toContain('drafting');
      expect(transitions).toContain('withdrawn');
    });

    it('returns multiple options for submitted', () => {
      const transitions = getAvailableTransitions('submitted');
      expect(transitions).toContain('won');
      expect(transitions).toContain('lost');
      expect(transitions).toContain('in_review');
      expect(transitions).toContain('withdrawn');
    });
  });

  describe('isTerminal', () => {
    it('returns true for terminal states', () => {
      expect(isTerminal('won')).toBe(true);
      expect(isTerminal('lost')).toBe(true);
      expect(isTerminal('withdrawn')).toBe(true);
    });

    it('returns false for active states', () => {
      expect(isTerminal('draft')).toBe(false);
      expect(isTerminal('drafting')).toBe(false);
      expect(isTerminal('submitted')).toBe(false);
    });
  });

  describe('isActive', () => {
    it('returns true for active states', () => {
      expect(isActive('draft')).toBe(true);
      expect(isActive('drafting')).toBe(true);
      expect(isActive('submitted')).toBe(true);
    });

    it('returns false for terminal states', () => {
      expect(isActive('won')).toBe(false);
      expect(isActive('lost')).toBe(false);
      expect(isActive('withdrawn')).toBe(false);
    });

    it('is the opposite of isTerminal for all states', () => {
      for (const state of BID_STATES) {
        expect(isActive(state)).toBe(!isTerminal(state));
      }
    });
  });

  describe('BID_STATE_PROGRESSION', () => {
    it('contains only non-terminal states in order', () => {
      expect(BID_STATE_PROGRESSION).toEqual([
        'draft',
        'questions_extracted',
        'matching',
        'drafting',
        'in_review',
        'ready_for_export',
        'submitted',
      ]);
    });

    it('does not include terminal states', () => {
      expect(BID_STATE_PROGRESSION).not.toContain('won');
      expect(BID_STATE_PROGRESSION).not.toContain('lost');
      expect(BID_STATE_PROGRESSION).not.toContain('withdrawn');
    });
  });
});
