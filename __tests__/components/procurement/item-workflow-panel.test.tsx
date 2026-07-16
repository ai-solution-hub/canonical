/**
 * ItemWorkflowPanel — the §G stepper host (ID-145 {145.43}).
 *
 * Wires the custom Warm Meridian `WorkflowStepper` (ID-147 {147.15}) into the
 * item page over the {145.18} shape: BI-13 (state stepper/badge +
 * deadline/submission/issuing-org/outcome), BI-18 (only valid transitions
 * offered, an invalid jump refused with a surfaced reason). `WorkflowStepper`
 * itself is exhaustively covered by `workflow-stepper.test.tsx` — this file
 * covers the HOST's own responsibilities: prop wiring, the `transitioning`
 * indicator, and the defensive empty-state fallback for a null
 * `workflowState` ({145.18} legacy-shape note, BI-19).
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ItemWorkflowPanel } from '@/components/procurement/item-workflow-panel';

describe('ItemWorkflowPanel', () => {
  it('renders a stable mount point for page.tsx composition tests', () => {
    render(<ItemWorkflowPanel workflowState="drafting" />);
    expect(screen.getByTestId('item-workflow-panel')).toBeInTheDocument();
  });

  it('renders the current state via the stepper (non-colour-only label + badge, BI-13)', () => {
    render(<ItemWorkflowPanel workflowState="in_review" />);
    expect(screen.getByTestId('item-workflow-panel')).toHaveTextContent(
      'In Review',
    );
    expect(screen.getByText('Current state:')).toBeInTheDocument();
  });

  it('threads deadline/submission/issuing-organisation/outcome through to the stepper (BI-13/§G4)', () => {
    render(
      <ItemWorkflowPanel
        workflowState="won"
        deadline="2026-01-01"
        submissionDate="2026-01-15"
        issuingOrganisation="Test Council"
        outcome="won"
      />,
    );
    expect(screen.getByText(/Deadline:/)).toBeInTheDocument();
    expect(screen.getByText(/Submitted:/)).toBeInTheDocument();
    expect(
      screen.getByText(/Issuing organisation: Test Council/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Outcome: Won/)).toBeInTheDocument();
  });

  it('calls onTransition when a valid next state is selected (BI-18/§G3)', async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(
      <ItemWorkflowPanel workflowState="draft" onTransition={onTransition} />,
    );

    await user.click(
      screen.getByRole('button', { name: /Questions Extracted/ }),
    );

    expect(onTransition).toHaveBeenCalledWith('questions_extracted');
  });

  it('refuses an invalid jump with a surfaced reason instead of calling onTransition (BI-18/§G3)', async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(
      <ItemWorkflowPanel workflowState="draft" onTransition={onTransition} />,
    );

    await user.click(screen.getByRole('button', { name: /Submitted/ }));

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows an "Updating…" indicator while a transition is in flight', () => {
    render(<ItemWorkflowPanel workflowState="drafting" transitioning />);
    expect(screen.getByText('Updating workflow state…')).toBeInTheDocument();
  });

  it('omits the "Updating…" indicator when not transitioning', () => {
    render(<ItemWorkflowPanel workflowState="drafting" />);
    expect(
      screen.queryByText('Updating workflow state…'),
    ).not.toBeInTheDocument();
  });

  it('renders an inline empty card instead of a stepper when workflowState is null (defensive legacy-shape render, BI-19)', () => {
    render(<ItemWorkflowPanel workflowState={null} />);

    expect(screen.getByTestId('item-workflow-panel')).toBeInTheDocument();
    expect(screen.getByTestId('item-inline-states-empty')).toBeInTheDocument();
    expect(
      screen.getByText('Workflow state is not available for this item.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Current state:')).not.toBeInTheDocument();
  });

  it('forwards a custom className to the root element', () => {
    const { container } = render(
      <ItemWorkflowPanel workflowState="draft" className="my-extra-class" />,
    );
    expect(container.firstChild).toHaveClass('my-extra-class');
  });
});
