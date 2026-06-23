/**
 * MobileStepIndicator Component Tests
 *
 * Tests the mobile-only step indicator — step rendering, aria-current for
 * active step, completed step styling, and future step styling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import { MobileStepIndicator } from '@/components/create-content/mobile-step-indicator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MobileStepIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 3 steps (Basics, Content, Details)', () => {
    render(<MobileStepIndicator activeStep={1} />);
    expect(screen.getByText('Basics')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });

  it('active step has aria-current="step"', () => {
    render(<MobileStepIndicator activeStep={2} />);
    // Step 2 number indicator should have aria-current
    const stepIndicators = screen.getAllByText(/^[123]$/);
    const step2 = stepIndicators.find((el) => el.textContent === '2');
    expect(step2).toHaveAttribute('aria-current', 'step');
    // Step 1 and 3 should not
    const step1 = stepIndicators.find((el) => el.textContent === '1');
    expect(step1).not.toHaveAttribute('aria-current');
    const step3 = stepIndicators.find((el) => el.textContent === '3');
    expect(step3).not.toHaveAttribute('aria-current');
  });

  it('marks completed steps distinctly from the active step', () => {
    render(<MobileStepIndicator activeStep={3} />);
    const stepIndicators = screen.getAllByText(/^[123]$/);
    const step1 = stepIndicators.find((el) => el.textContent === '1')!;
    const step3 = stepIndicators.find((el) => el.textContent === '3')!;
    // Completed step (1) is distinct from the active step (3)
    expect(step1).toHaveAttribute('data-step-state', 'completed');
    expect(step3).toHaveAttribute('data-step-state', 'active');
  });

  it('marks not-yet-reached steps as future', () => {
    render(<MobileStepIndicator activeStep={1} />);
    const stepIndicators = screen.getAllByText(/^[123]$/);
    const step3 = stepIndicators.find((el) => el.textContent === '3')!;
    expect(step3).toHaveAttribute('data-step-state', 'future');
  });
});
