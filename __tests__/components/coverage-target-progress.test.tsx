/**
 * CoverageTargetProgress Component Tests
 *
 * Tests rendering with various target states:
 *   - No targets (renders nothing)
 *   - All targets on track
 *   - Below target status
 *   - Mixed metrics per domain
 *   - max_expired inverse logic
 *   - Missing coverage data for a domain
 *   - "Target Goals" heading and info tooltip
 *   - "Current content" / "Target goal" labels on metric values
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { CoverageTargetProgress } from '@/components/coverage/coverage-target-progress';
import type { CoverageTargetRow } from '@/hooks/use-coverage-targets';
import type { CoverageSummaryRow } from '@/components/coverage/coverage-summary-cards';

// Mock Tooltip components to render children directly for testing
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip">{children}</div>
  ),
  TooltipTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

const DOMAIN_UUID = '00000000-0000-4000-8000-000000000001';
const DOMAIN_UUID_2 = '00000000-0000-4000-8000-000000000002';

function makeTarget(
  overrides: Partial<CoverageTargetRow> = {},
): CoverageTargetRow {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    domain_id: DOMAIN_UUID,
    metric_name: 'item_count',
    target_value: 10,
    domain_name: 'Compliance',
    ...overrides,
  };
}

function makeCoverage(
  overrides: Partial<CoverageSummaryRow> = {},
): CoverageSummaryRow {
  return {
    domain_name: 'Compliance',
    domain_colour: 'corporate',
    total_items: 15,
    fresh_pct: 80,
    gap_count: 0,
    expired_count: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoverageTargetProgress', () => {
  it('renders nothing when targets is empty', () => {
    const { container } = render(
      <CoverageTargetProgress targets={[]} coverageData={[makeCoverage()]} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders domain with on-track status', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 10 })]}
        coverageData={[makeCoverage({ total_items: 15 })]}
      />,
    );

    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('renders domain with below-target status', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 20 })]}
        coverageData={[makeCoverage({ total_items: 5 })]}
      />,
    );

    expect(screen.getByText('Below target')).toBeInTheDocument();
  });

  it('renders fresh_pct metric correctly', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'fresh_pct', target_value: 70 })]}
        coverageData={[makeCoverage({ fresh_pct: 80 })]}
      />,
    );

    expect(screen.getByText('Freshness %')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
    // Current and target values are in separate labelled spans
    expect(screen.getByTitle('Current content')).toHaveTextContent('80%');
    expect(screen.getByTitle('Target goal')).toHaveTextContent('70%');
  });

  it('renders max_expired metric with inverse logic', () => {
    // 1 expired, target is 2 max -> on track
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'max_expired', target_value: 2 })]}
        coverageData={[makeCoverage({ expired_count: 1 })]}
      />,
    );

    expect(screen.getByText('Max expired')).toBeInTheDocument();
    expect(screen.getByText('On track')).toBeInTheDocument();
  });

  it('shows below target when max_expired exceeds target', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'max_expired', target_value: 1 })]}
        coverageData={[makeCoverage({ expired_count: 5 })]}
      />,
    );

    expect(screen.getByText('Below target')).toBeInTheDocument();
  });

  it('renders multiple metrics for a domain', () => {
    render(
      <CoverageTargetProgress
        targets={[
          makeTarget({ metric_name: 'item_count', target_value: 10 }),
          makeTarget({ metric_name: 'fresh_pct', target_value: 70 }),
        ]}
        coverageData={[makeCoverage({ total_items: 15, fresh_pct: 80 })]}
      />,
    );

    expect(screen.getByText('Item count')).toBeInTheDocument();
    expect(screen.getByText('Freshness %')).toBeInTheDocument();
  });

  it('renders multiple domains', () => {
    render(
      <CoverageTargetProgress
        targets={[
          makeTarget({
            domain_id: DOMAIN_UUID,
            domain_name: 'Compliance',
            metric_name: 'item_count',
            target_value: 10,
          }),
          makeTarget({
            id: '00000000-0000-4000-8000-000000000020',
            domain_id: DOMAIN_UUID_2,
            domain_name: 'HR',
            metric_name: 'item_count',
            target_value: 5,
          }),
        ]}
        coverageData={[
          makeCoverage({ domain_name: 'Compliance', total_items: 15 }),
          makeCoverage({ domain_name: 'HR', total_items: 3 }),
        ]}
      />,
    );

    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('HR')).toBeInTheDocument();
  });

  it('handles missing coverage data for a domain', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 10 })]}
        coverageData={[]}
      />,
    );

    // Should still render the domain with 0 items
    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('Below target')).toBeInTheDocument();
  });

  it('skips targets with null domain_name', () => {
    const { container } = render(
      <CoverageTargetProgress
        targets={[makeTarget({ domain_name: null })]}
        coverageData={[makeCoverage()]}
      />,
    );

    // No domain cards should render
    expect(
      container.querySelectorAll('[class*="rounded-lg border"]'),
    ).toHaveLength(0);
  });

  it('has accessible aria labels on progress bars with current/target wording', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 10 })]}
        coverageData={[makeCoverage({ total_items: 15 })]}
      />,
    );

    const progressBar = screen.getByLabelText('Item count: current 15, target 10');
    expect(progressBar).toBeInTheDocument();
  });

  it('renders section heading as "Target Goals"', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 10 })]}
        coverageData={[makeCoverage({ total_items: 15 })]}
      />,
    );

    expect(screen.getByText('Target Goals')).toBeInTheDocument();
  });

  it('renders info tooltip trigger with accessible label', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 10 })]}
        coverageData={[makeCoverage({ total_items: 15 })]}
      />,
    );

    const helpButton = screen.getByRole('button', { name: /what are target goals/i });
    expect(helpButton).toBeInTheDocument();
  });

  it('renders current value with title attribute "Current content"', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 10 })]}
        coverageData={[makeCoverage({ total_items: 15 })]}
      />,
    );

    const currentSpan = screen.getByTitle('Current content');
    expect(currentSpan).toBeInTheDocument();
    expect(currentSpan).toHaveTextContent('15');
  });

  it('renders target value with title attribute "Target goal"', () => {
    render(
      <CoverageTargetProgress
        targets={[makeTarget({ metric_name: 'item_count', target_value: 10 })]}
        coverageData={[makeCoverage({ total_items: 15 })]}
      />,
    );

    const targetSpan = screen.getByTitle('Target goal');
    expect(targetSpan).toBeInTheDocument();
    expect(targetSpan).toHaveTextContent('10');
  });
});
