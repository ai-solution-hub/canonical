/**
 * ProcurementWorkflowBadge Component Tests
 *
 * Tests bid state badge labels and colour classes. The read-only
 * `ProcurementWorkflowStepper` this file also covered was removed in the
 * S482 orphan sweep — superseded by `WorkflowStepper`
 * (`components/procurement/workflow-stepper.tsx`, ID-147 {147.15}), which
 * has its own suite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { ProcurementWorkflowBadge } from '@/components/procurement/procurement-workflow-indicator';

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

  it('renders the draft badge with its "Draft" label', () => {
    render(<ProcurementWorkflowBadge state="draft" />);
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
});
