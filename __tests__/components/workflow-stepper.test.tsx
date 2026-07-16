/**
 * WorkflowStepper Component Tests (ID-147 {147.15})
 *
 * Behaviour-first: covers §G1 (10-state linear stepper + current-state
 * badge), §G2 (completed/current/upcoming distinctly marked, never colour
 * alone), §G3 (transition control offers only canTransition-valid next
 * states; an invalid jump is refused with a surfaced, readable reason — not
 * a silent no-op), and §G4 (deadline/submission/issuing-organisation/outcome
 * shown with a text label or icon, never colour alone).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkflowStepper } from '@/components/procurement/workflow-stepper';

describe('WorkflowStepper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- §G1: linear 10-state stepper + current-state badge ----

  it('renders all 10 workflow_state states in order', () => {
    render(<WorkflowStepper currentState="drafting" />);

    for (const label of [
      'Draft',
      'Questions Extracted',
      'Matching',
      'Drafting',
      'In Review',
      'Ready for Export',
      'Submitted',
      'Won',
      'Lost',
      'Withdrawn',
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('distinctly marks the current state with a badge and label', () => {
    render(<WorkflowStepper currentState="in_review" />);

    expect(screen.getByText('Current state:')).toBeInTheDocument();
    // Badge label + stepper step label both render "In Review"
    expect(screen.getAllByText('In Review').length).toBeGreaterThanOrEqual(2);

    const currentStepButton = screen.getByRole('button', {
      name: /In Review/,
    });
    expect(currentStepButton).toHaveAttribute('aria-current', 'step');
  });

  it('marks exactly one step as aria-current="step"', () => {
    render(<WorkflowStepper currentState="matching" />);

    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current.length).toBe(1);
  });

  // ---- §G2: completed / current / upcoming never colour-only ----

  it('every step carries a visible text label regardless of status', () => {
    render(<WorkflowStepper currentState="ready_for_export" />);

    // Completed (draft..submitted precede ready_for_export... actually
    // ready_for_export precedes submitted) — assert a completed step (draft)
    // and an upcoming step (submitted) both still render their text label.
    expect(screen.getByRole('button', { name: /^Draft$/ })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Submitted/ }),
    ).toBeInTheDocument();
  });

  it('renders a terminal outcome step with its distinguishing icon+label regardless of position', () => {
    render(<WorkflowStepper currentState="draft" />);

    const wonButton = screen.getByRole('button', { name: /Won/ });
    expect(wonButton.querySelector('svg')).toBeInTheDocument();
  });

  // ---- §G3: transition control offers only canTransition-valid next states ----

  it('lists only canTransition-valid next states as "Available next states"', () => {
    render(<WorkflowStepper currentState="draft" />);

    expect(
      screen.getByText(
        'Available next states: Questions Extracted, Withdrawn.',
      ),
    ).toBeInTheDocument();
  });

  it('shows a "final state" message when there are no valid next states', () => {
    render(<WorkflowStepper currentState="won" />);

    expect(
      screen.getByText(
        'Won is a final state — no further transitions are available.',
      ),
    ).toBeInTheDocument();
  });

  it('calls onTransition when a valid next state is clicked', async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(
      <WorkflowStepper currentState="draft" onTransition={onTransition} />,
    );

    await user.click(
      screen.getByRole('button', { name: /Questions Extracted/ }),
    );

    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition).toHaveBeenCalledWith('questions_extracted');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('refuses an invalid jump with a surfaced, readable reason instead of a silent no-op', async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(
      <WorkflowStepper currentState="draft" onTransition={onTransition} />,
    );

    await user.click(screen.getByRole('button', { name: /Submitted/ }));

    expect(onTransition).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Draft');
    expect(alert).toHaveTextContent('Submitted');
    expect(alert).toHaveTextContent('Questions Extracted');
  });

  it('refuses a jump attempted from a terminal (final) state', async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(<WorkflowStepper currentState="won" onTransition={onTransition} />);

    await user.click(screen.getByRole('button', { name: /Lost/ }));

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('final state');
  });

  it('clicking the current step is a no-op with no error surfaced', async () => {
    const user = userEvent.setup();
    const onTransition = vi.fn();
    render(
      <WorkflowStepper currentState="draft" onTransition={onTransition} />,
    );

    await user.click(screen.getByRole('button', { name: /^Draft$/ }));

    expect(onTransition).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears a prior refusal reason once a valid transition is made', async () => {
    const user = userEvent.setup();
    render(<WorkflowStepper currentState="draft" onTransition={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /Submitted/ }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /Questions Extracted/ }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ---- §G4: deadline / submission / issuing org / outcome — never colour alone ----

  it('shows an overdue deadline with a text label alongside the icon', () => {
    render(<WorkflowStepper currentState="drafting" deadline="2020-01-01" />);

    expect(screen.getByText(/Deadline: 01\/01\/2020/)).toBeInTheDocument();
    expect(screen.getByText('(Overdue)')).toBeInTheDocument();
  });

  it('shows submission date, issuing organisation and outcome each with a text label', () => {
    render(
      <WorkflowStepper
        currentState="won"
        submissionDate="2026-06-01"
        issuingOrganisation="Test Council"
        outcome="won"
      />,
    );

    expect(screen.getByText(/Submitted: 01\/06\/2026/)).toBeInTheDocument();
    expect(
      screen.getByText(/Issuing organisation: Test Council/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Outcome: Won/)).toBeInTheDocument();
  });

  it('omits the metadata row entirely when no deadline/submission/org/outcome is supplied', () => {
    render(<WorkflowStepper currentState="draft" />);

    expect(screen.queryByText(/Deadline:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Submitted:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Issuing organisation:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Outcome:/)).not.toBeInTheDocument();
  });

  it('forwards a custom className to the root element', () => {
    const { container } = render(
      <WorkflowStepper currentState="draft" className="my-extra-class" />,
    );

    expect(container.firstChild).toHaveClass('my-extra-class');
  });
});
