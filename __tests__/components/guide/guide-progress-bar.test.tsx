/**
 * GuideProgressBar Component Tests
 *
 * Tests coverage label (renamed from Progress), percentage calculation,
 * completion state styling, accessibility attributes, and edge cases.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { GuideProgressBar } from '@/components/guide/guide-progress-bar';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideProgressBar', () => {
  it('renders with "Coverage" label (not "Progress")', () => {
    render(<GuideProgressBar populated={2} total={5} />);

    expect(screen.getByText(/Coverage:/)).toBeInTheDocument();
    expect(screen.queryByText(/Progress:/)).not.toBeInTheDocument();
  });

  it('shows correct populated/total count', () => {
    render(<GuideProgressBar populated={3} total={7} />);

    expect(
      screen.getByText('Coverage: 3/7 required sections populated'),
    ).toBeInTheDocument();
  });

  it('calculates percentage correctly', () => {
    render(<GuideProgressBar populated={2} total={4} />);

    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('rounds percentage to nearest integer', () => {
    render(<GuideProgressBar populated={1} total={3} />);

    expect(screen.getByText('33%')).toBeInTheDocument();
  });

  it('shows 0% when populated is 0', () => {
    render(<GuideProgressBar populated={0} total={5} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('shows 100% when all populated', () => {
    render(<GuideProgressBar populated={5} total={5} />);

    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('handles zero total without division error', () => {
    render(<GuideProgressBar populated={0} total={0} />);

    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('has accessible progressbar role', () => {
    render(<GuideProgressBar populated={3} total={5} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toBeInTheDocument();
    expect(progressbar).toHaveAttribute('aria-valuenow', '3');
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '5');
  });

  it('has correct coverage aria-label', () => {
    render(<GuideProgressBar populated={2} total={4} />);

    const progressbar = screen.getByRole('progressbar');
    expect(progressbar).toHaveAttribute(
      'aria-label',
      'Guide coverage: 2 of 4 required sections populated',
    );
  });
});
