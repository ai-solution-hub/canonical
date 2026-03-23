/**
 * CoverageCell Component Tests
 *
 * Tests the coverage cell — browse link, freshness indicators,
 * and "Review stale items" navigation link.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { CoverageCellData } from '@/components/coverage-cell';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { CoverageCell } from '@/components/coverage-cell';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createCellData(overrides: Partial<CoverageCellData> = {}): CoverageCellData {
  return {
    domain_name: 'security',
    subtopic_name: 'data-protection',
    item_count: 10,
    fresh_count: 6,
    aging_count: 2,
    stale_count: 1,
    expired_count: 1,
    ...overrides,
  };
}

const formatSubtopic = (s: string) =>
  s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoverageCell', () => {
  it('renders subtopic name and item count', () => {
    render(<CoverageCell data={createCellData()} formatSubtopic={formatSubtopic} />);

    expect(screen.getByText('Data Protection')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders browse link with correct query params', () => {
    render(<CoverageCell data={createCellData()} formatSubtopic={formatSubtopic} />);

    const browseLink = screen.getByText('Data Protection').closest('a');
    expect(browseLink).toHaveAttribute(
      'href',
      expect.stringContaining('/browse?'),
    );
    expect(browseLink?.getAttribute('href')).toContain('domain=security');
    expect(browseLink?.getAttribute('href')).toContain('subtopic=data-protection');
  });

  it('renders freshness indicators for non-zero counts', () => {
    render(<CoverageCell data={createCellData()} formatSubtopic={formatSubtopic} />);

    expect(screen.getByText('6 Fresh')).toBeInTheDocument();
    expect(screen.getByText('2 Aging')).toBeInTheDocument();
    expect(screen.getByText('1 Stale')).toBeInTheDocument();
    expect(screen.getByText('1 Expired')).toBeInTheDocument();
  });

  it('hides freshness indicators with zero counts', () => {
    const data = createCellData({
      aging_count: 0,
      stale_count: 0,
      expired_count: 0,
    });
    render(<CoverageCell data={data} formatSubtopic={formatSubtopic} />);

    expect(screen.getByText('6 Fresh')).toBeInTheDocument();
    expect(screen.queryByText(/Aging/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stale/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Expired/)).not.toBeInTheDocument();
  });

  describe('Review stale items link', () => {
    it('shows "Review stale items" link when stale + expired > 0', () => {
      render(<CoverageCell data={createCellData()} formatSubtopic={formatSubtopic} />);

      const reviewLink = screen.getByRole('link', { name: /review.*stale.*items.*data protection/i });
      expect(reviewLink).toBeInTheDocument();
      expect(reviewLink).toHaveAttribute('href', expect.stringContaining('/review?'));
      expect(reviewLink.getAttribute('href')).toContain('domain=security');
      expect(reviewLink.getAttribute('href')).toContain('status=all');
    });

    it('shows singular "item" when stale + expired = 1', () => {
      const data = createCellData({ stale_count: 1, expired_count: 0 });
      render(<CoverageCell data={data} formatSubtopic={formatSubtopic} />);

      expect(screen.getByText('Review stale item')).toBeInTheDocument();
    });

    it('shows plural "items" when stale + expired > 1', () => {
      const data = createCellData({ stale_count: 2, expired_count: 1 });
      render(<CoverageCell data={data} formatSubtopic={formatSubtopic} />);

      expect(screen.getByText('Review stale items')).toBeInTheDocument();
    });

    it('does not show review link when stale + expired = 0', () => {
      const data = createCellData({ stale_count: 0, expired_count: 0 });
      render(<CoverageCell data={data} formatSubtopic={formatSubtopic} />);

      expect(screen.queryByText(/Review stale/)).not.toBeInTheDocument();
    });

    it('includes ArrowRight icon in review link', () => {
      render(<CoverageCell data={createCellData()} formatSubtopic={formatSubtopic} />);

      const reviewLink = screen.getByRole('link', { name: /review.*stale/i });
      // The ArrowRight icon is rendered with aria-hidden="true"
      const icon = reviewLink.querySelector('[aria-hidden="true"]');
      expect(icon).toBeInTheDocument();
    });
  });
});
