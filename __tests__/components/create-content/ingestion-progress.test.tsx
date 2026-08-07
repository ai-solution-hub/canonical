/**
 * IngestionProgress Component Tests
 *
 * Tests the pipeline progress display component in both
 * full and compact modes.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  IngestionProgress,
  type IngestionStep,
} from '@/components/create-content/ingestion-progress';

function makeSteps(
  overrides: Partial<Record<number, Partial<IngestionStep>>> = {},
): IngestionStep[] {
  const defaults: IngestionStep[] = [
    { label: 'Uploading', status: 'done' },
    { label: 'Extracting text', status: 'done' },
    { label: 'Generating embedding', status: 'active' },
    { label: 'Classifying', status: 'pending' },
    { label: 'Summarising', status: 'pending' },
  ];
  return defaults.map((step, i) => ({ ...step, ...overrides[i] }));
}

describe('IngestionProgress', () => {
  it('renders all steps with correct labels', () => {
    const steps = makeSteps();
    render(<IngestionProgress steps={steps} />);

    expect(screen.getByText('Uploading')).toBeInTheDocument();
    expect(screen.getByText('Extracting text')).toBeInTheDocument();
    expect(screen.getByText('Generating embedding')).toBeInTheDocument();
    expect(screen.getByText('Classifying')).toBeInTheDocument();
    expect(screen.getByText('Summarising')).toBeInTheDocument();
  });

  it('shows check icon for done steps (via sr-only text)', () => {
    const steps = makeSteps();
    render(<IngestionProgress steps={steps} />);

    // Done steps have "(Complete)" sr-only text
    const completeTexts = screen.getAllByText('(Complete)');
    expect(completeTexts).toHaveLength(2); // Uploading + Extracting text
  });

  it('shows active status for active steps (via sr-only text)', () => {
    const steps = makeSteps();
    render(<IngestionProgress steps={steps} />);

    expect(screen.getByText('(In progress)')).toBeInTheDocument();
  });

  it('shows pending status for pending steps (via sr-only text)', () => {
    const steps = makeSteps();
    render(<IngestionProgress steps={steps} />);

    const pendingTexts = screen.getAllByText('(Pending)');
    expect(pendingTexts).toHaveLength(2);
  });

  it('compact mode shows single-line summary', () => {
    const steps = makeSteps();
    render(<IngestionProgress steps={steps} compact />);

    // Should show the active step label and step count
    expect(screen.getByText(/Generating embedding/)).toBeInTheDocument();
    expect(screen.getByText(/step 3\/5/)).toBeInTheDocument();
  });

  it('shows warnings section when warnings exist', () => {
    const steps = makeSteps({
      0: { status: 'done' },
      1: { status: 'done' },
      2: { status: 'done' },
      3: { status: 'done' },
      4: { status: 'done' },
    });

    render(
      <IngestionProgress
        steps={steps}
        warnings={['Embedding generation failed', 'Classification timed out']}
      />,
    );

    expect(screen.getByText('2 warnings')).toBeInTheDocument();
    expect(screen.getByText('Embedding generation failed')).toBeInTheDocument();
    expect(screen.getByText('Classification timed out')).toBeInTheDocument();
  });

  it('has aria-live="polite" on the container', () => {
    const steps = makeSteps();
    const { container } = render(<IngestionProgress steps={steps} />);

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  it('compact mode shows error state when a step has failed', () => {
    const steps = makeSteps({
      2: { status: 'error' },
    });
    // Remove active step — 0 and 1 done, 2 error, 3 and 4 pending
    render(<IngestionProgress steps={steps} compact />);

    expect(screen.getByText('Pipeline failed')).toBeInTheDocument();
  });
});
