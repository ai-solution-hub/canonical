/**
 * ConceptHelp Component Tests
 *
 * Exercises the 8 platform concept keys, the keyboard-focusable trigger,
 * and the tooltip content rendered on focus.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  ConceptHelp,
  CONCEPT_COPY,
  type ConceptKey,
} from '@/components/ui/concept-help';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderConcept(concept: ConceptKey) {
  return render(
    <TooltipProvider delayDuration={0}>
      <ConceptHelp concept={concept} />
    </TooltipProvider>,
  );
}

const ALL_KEYS: ConceptKey[] = [
  'coverage',
  'priority-gaps',
  'governance-review',
  'workspace',
  'layer',
  'domain',
  'stream',
  'freshness',
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConceptHelp', () => {
  it('renders a focusable trigger with a concept-scoped aria-label', () => {
    renderConcept('coverage');
    const trigger = screen.getByRole('button', {
      name: /what does coverage mean\?/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('disabled');
  });

  it('opens the tooltip on keyboard focus', async () => {
    const user = userEvent.setup();
    renderConcept('coverage');

    // Tab into the trigger — radix should open on focus.
    await user.tab();

    await waitFor(() => {
      // Tooltip content is portalled; use findAllByText to pick it up.
      const matches = screen.getAllByText(CONCEPT_COPY.coverage.body);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('opens the tooltip on hover', async () => {
    const user = userEvent.setup();
    renderConcept('freshness');

    const trigger = screen.getByRole('button', {
      name: /what does freshness mean\?/i,
    });
    await user.hover(trigger);

    await waitFor(() => {
      const matches = screen.getAllByText(CONCEPT_COPY.freshness.body);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it.each(ALL_KEYS)('maps %s to non-empty copy', (concept) => {
    const copy = CONCEPT_COPY[concept];
    expect(copy).toBeDefined();
    expect(copy.body.trim().length).toBeGreaterThan(0);
    expect(copy.label.trim().length).toBeGreaterThan(0);
  });

  it('renders distinct bodies for every concept key', () => {
    const bodies = ALL_KEYS.map((key) => CONCEPT_COPY[key].body);
    const unique = new Set(bodies);
    expect(unique.size).toBe(ALL_KEYS.length);
  });

  it('exposes the correct aria-label per concept', () => {
    for (const key of ALL_KEYS) {
      const { unmount } = renderConcept(key);
      const label = CONCEPT_COPY[key].label;
      const trigger = screen.getByRole('button', {
        name: new RegExp(`what does ${label} mean\\?`, 'i'),
      });
      expect(trigger).toBeInTheDocument();
      unmount();
    }
  });
});
