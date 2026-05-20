/**
 * ProcurementWorkflowBadge & ProcurementWorkflowStepper Component Tests
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

import {
  ProcurementWorkflowBadge,
  ProcurementWorkflowStepper,
} from '@/components/procurement/procurement-workflow-indicator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProcurementWorkflowBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correct label for each state', () => {
    const states: Array<{
      state: 'draft' | 'in_review' | 'won' | 'lost' | 'withdrawn';
      label: string;
    }> = [
      { state: 'draft', label: 'Draft' },
      { state: 'in_review', label: 'In Review' },
      { state: 'won', label: 'Won' },
      { state: 'lost', label: 'Lost' },
      { state: 'withdrawn', label: 'Withdrawn' },
    ];

    for (const { state, label } of states) {
      const { unmount } = render(<ProcurementWorkflowBadge state={state} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies correct colour classes for draft state', () => {
    const { container } = render(<ProcurementWorkflowBadge state="draft" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('bg-bid-draft-bg');
    expect(badge?.className).toContain('text-bid-draft');
    expect(badge?.className).toContain('border-bid-draft-border');
  });
});

describe('ProcurementWorkflowStepper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows completed steps before the current step', () => {
    render(<ProcurementWorkflowStepper state="drafting" />);

    // Drafting is index 3 in progression — draft, questions_extracted, matching should be completed
    // They should render checkmark icons (hidden from accessibility tree)
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThanOrEqual(4);
  });

  it('highlights current step with aria-current="step"', () => {
    render(<ProcurementWorkflowStepper state="in_review" />);

    const currentStep = document.querySelector('[aria-current="step"]');
    expect(currentStep).toBeInTheDocument();
  });

  it('shows terminal states (won, lost, withdrawn) as extra step', () => {
    render(<ProcurementWorkflowStepper state="won" />);

    // Terminal states add an extra listitem beyond the progression
    // Both abbreviated (mobile) and full (desktop) labels are present
    expect(screen.getAllByText('Won').length).toBeGreaterThanOrEqual(1);
    // Terminal step should have aria-current="step"
    const currentSteps = document.querySelectorAll('[aria-current="step"]');
    expect(currentSteps.length).toBeGreaterThanOrEqual(1);
  });

  it('shows correct label for lost terminal state', () => {
    render(<ProcurementWorkflowStepper state="lost" />);

    // Both abbreviated (mobile) and full (desktop) labels are present
    expect(screen.getAllByText('Lost').length).toBeGreaterThanOrEqual(1);
  });

  it('has role="list" with aria-label', () => {
    render(<ProcurementWorkflowStepper state="draft" />);

    expect(
      screen.getByRole('list', { name: 'Procurement progress' }),
    ).toBeInTheDocument();
  });

  it('each step has role="listitem"', () => {
    render(<ProcurementWorkflowStepper state="drafting" />);

    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBeGreaterThan(0);
  });

  it('renders abbreviated mobile labels alongside full desktop labels', () => {
    const { container } = render(<ProcurementWorkflowStepper state="in_review" />);

    // Both abbreviated and full labels should be in the DOM
    // Full labels for progression steps (desktop visible)
    expect(screen.getByText('In Review')).toBeInTheDocument();
    expect(screen.getByText('Questions Extracted')).toBeInTheDocument();

    // Abbreviated labels for mobile (aria-hidden but present)
    const mobileLabels = container.querySelectorAll('[aria-hidden="true"]');
    const mobileTextContent = Array.from(mobileLabels).map(
      (el) => el.textContent,
    );
    expect(mobileTextContent).toContain('Review');
    expect(mobileTextContent).toContain('Extract');
  });

  it('shows abbreviated label for terminal state on mobile', () => {
    const { container } = render(<ProcurementWorkflowStepper state="won" />);

    // Both abbreviated and full labels present
    expect(screen.getAllByText('Won').length).toBeGreaterThanOrEqual(1);

    // Abbreviated mobile label also present (aria-hidden span)
    const mobileLabels = container.querySelectorAll('span[aria-hidden="true"]');
    const mobileTextContent = Array.from(mobileLabels).map(
      (el) => el.textContent,
    );
    // 'Won' is both abbreviated and full label
    expect(mobileTextContent).toContain('Won');
  });
});
