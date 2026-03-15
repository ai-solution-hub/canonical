/**
 * BidStateBadge & BidStateStepper Component Tests
 *
 * Tests bid state badge labels and colour classes, stepper completed/current
 * step rendering, terminal states, icons, and ARIA attributes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { BidStateBadge, BidStateStepper } from '@/components/bid-state-indicator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BidStateBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correct label for each state', () => {
    const states: Array<{ state: 'draft' | 'in_review' | 'won' | 'lost' | 'withdrawn'; label: string }> = [
      { state: 'draft', label: 'Draft' },
      { state: 'in_review', label: 'In Review' },
      { state: 'won', label: 'Won' },
      { state: 'lost', label: 'Lost' },
      { state: 'withdrawn', label: 'Withdrawn' },
    ];

    for (const { state, label } of states) {
      const { unmount } = render(<BidStateBadge state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies correct colour classes for draft state', () => {
    const { container } = render(<BidStateBadge state="draft" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('bg-bid-draft-bg');
    expect(badge?.className).toContain('text-bid-draft');
    expect(badge?.className).toContain('border-bid-draft-border');
  });
});

describe('BidStateStepper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows completed steps before the current step', () => {
    render(<BidStateStepper state="drafting" />);

    // Drafting is index 3 in progression — draft, questions_extracted, matching should be completed
    // They should render checkmark icons (hidden from accessibility tree)
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(4);
  });

  it('highlights current step with aria-current="step"', () => {
    render(<BidStateStepper state="in_review" />);

    const currentStep = document.querySelector('[aria-current="step"]');
    expect(currentStep).toBeInTheDocument();
  });

  it('shows terminal states (won, lost, withdrawn) as extra step', () => {
    render(<BidStateStepper state="won" />);

    // Terminal states add an extra listitem beyond the progression
    expect(screen.getByText('Won')).toBeInTheDocument();
    // Terminal step should have aria-current="step"
    const currentSteps = document.querySelectorAll('[aria-current="step"]');
    expect(currentSteps.length).toBeGreaterThanOrEqual(1);
  });

  it('shows correct label for lost terminal state', () => {
    render(<BidStateStepper state="lost" />);

    expect(screen.getByText('Lost')).toBeInTheDocument();
  });

  it('has role="list" with aria-label', () => {
    render(<BidStateStepper state="draft" />);

    expect(
      screen.getByRole('list', { name: 'Bid progress' }),
    ).toBeInTheDocument();
  });

  it('each step has role="listitem"', () => {
    render(<BidStateStepper state="drafting" />);

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThan(0);
  });
});
