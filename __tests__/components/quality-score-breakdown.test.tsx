import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QualityScoreBreakdown } from '@/components/shared/quality-score-breakdown';
import type { QualityScoreInput } from '@/lib/quality-score';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Excellent score: fresh, high confidence, all depth layers, summary, citations */
const excellentItem: QualityScoreInput = {
  freshness: 'fresh',
  classification_confidence: 0.95,
  brief: 'Brief content here',
  detail: 'Detailed content here',
  reference: 'Reference content here',
  ai_summary: 'This is an AI summary.',
  citation_count: 5,
};

/** Poor score: expired, no confidence, no layers, no summary, no citations */
const poorItem: QualityScoreInput = {
  freshness: 'expired',
  classification_confidence: 0,
  brief: null,
  detail: null,
  reference: null,
  ai_summary: null,
  citation_count: 0,
};

/** Good score: fresh, moderate confidence, two layers, summary, no citations */
const goodItem: QualityScoreInput = {
  freshness: 'fresh',
  classification_confidence: 0.75,
  brief: 'Brief content here',
  detail: 'Detailed content here',
  reference: null,
  ai_summary: 'This is an AI summary.',
  citation_count: 0,
};

/** Fair score: ageing, partial confidence, one layer, summary, no citations */
const fairItem: QualityScoreInput = {
  freshness: 'ageing',
  classification_confidence: 0.5,
  brief: 'Brief only',
  detail: null,
  reference: null,
  ai_summary: 'A summary.',
  citation_count: 0,
};

/** All nulls/undefined — graceful fallback */
const emptyItem: QualityScoreInput = {
  freshness: null,
  classification_confidence: null,
  brief: null,
  detail: null,
  reference: null,
  ai_summary: null,
  citation_count: undefined,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QualityScoreBreakdown', () => {
  // -------------------------------------------------------------------------
  // Badge rendering
  // -------------------------------------------------------------------------

  it('renders the quality score badge with label and numeric score', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    expect(screen.getByText('Excellent')).toBeInTheDocument();
    // Score should be rendered (exact number depends on calculation)
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
  });

  it('renders "Poor" label for a poor-scoring item', () => {
    render(<QualityScoreBreakdown item={poorItem} />);
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });

  it('renders "Good" label for a good-scoring item', () => {
    render(<QualityScoreBreakdown item={goodItem} />);
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('renders "Fair" label for a fair-scoring item', () => {
    render(<QualityScoreBreakdown item={fairItem} />);
    expect(screen.getByText('Fair')).toBeInTheDocument();
  });

  it('renders appropriate label for an item with all null data', () => {
    render(<QualityScoreBreakdown item={emptyItem} />);
    // freshness defaults to fresh (30), confidence null = 0, completeness 0,
    // summary 0, citations 0 => score 30 => "Needs Work"
    expect(screen.getByText('Needs Work')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Colour classes on the badge
  // -------------------------------------------------------------------------

  it('applies green colour classes for Excellent label', () => {
    const { container } = render(
      <QualityScoreBreakdown item={excellentItem} />,
    );
    const badge = container.querySelector('.rounded-full');
    expect(badge?.className).toContain('text-quality-good');
    expect(badge?.className).toContain('bg-quality-good-bg');
  });

  it('applies destructive colour classes for Poor label', () => {
    const { container } = render(
      <QualityScoreBreakdown item={poorItem} />,
    );
    const badge = container.querySelector('.rounded-full');
    expect(badge?.className).toContain('text-destructive');
    expect(badge?.className).toContain('bg-destructive/10');
  });

  // -------------------------------------------------------------------------
  // Expand / collapse
  // -------------------------------------------------------------------------

  it('does not show component breakdown initially', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    expect(
      screen.queryByRole('region', { name: /quality score component breakdown/i }),
    ).not.toBeInTheDocument();
  });

  it('shows component breakdown when clicked', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getByRole('region', { name: /quality score component breakdown/i }),
    ).toBeInTheDocument();
  });

  it('hides component breakdown when clicked again', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(
      screen.getByRole('region', { name: /quality score component breakdown/i }),
    ).toBeInTheDocument();
    fireEvent.click(button);
    expect(
      screen.queryByRole('region', { name: /quality score component breakdown/i }),
    ).not.toBeInTheDocument();
  });

  it('sets aria-expanded correctly on toggle', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  // -------------------------------------------------------------------------
  // All 5 components displayed
  // -------------------------------------------------------------------------

  it('displays all 5 component labels when expanded', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('Freshness')).toBeInTheDocument();
    expect(screen.getByText('Classification')).toBeInTheDocument();
    expect(screen.getByText('Completeness')).toBeInTheDocument();
    expect(screen.getByText('AI Summary')).toBeInTheDocument();
    expect(screen.getByText('Citations')).toBeInTheDocument();
  });

  it('displays correct max values for each component', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    fireEvent.click(screen.getByRole('button'));

    // Check that each value/max format is present
    // Freshness max 30, Confidence max 20, Completeness max 20, Summary max 15, Citations max 15
    const region = screen.getByRole('region');
    expect(region.textContent).toContain('/30');
    expect(region.textContent).toContain('/20');
    expect(region.textContent).toContain('/15');
  });

  // -------------------------------------------------------------------------
  // Progress bars
  // -------------------------------------------------------------------------

  it('renders 5 progress bars when expanded', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    fireEvent.click(screen.getByRole('button'));

    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars).toHaveLength(5);
  });

  it('progress bars have correct aria attributes', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    fireEvent.click(screen.getByRole('button'));

    const progressBars = screen.getAllByRole('progressbar');
    // Freshness bar should have max 30
    const freshnessBar = progressBars[0];
    expect(freshnessBar).toHaveAttribute('aria-valuemin', '0');
    expect(freshnessBar).toHaveAttribute('aria-valuemax', '30');
    expect(freshnessBar).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Freshness'),
    );
  });

  it('progress bar fill widths are proportional to score/max', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    fireEvent.click(screen.getByRole('button'));

    const progressBars = screen.getAllByRole('progressbar');
    // For excellent item, freshness is "fresh" => raw 100, weight 0.3 => 30/30 = 100%
    const freshnessFill = progressBars[0].firstElementChild as HTMLElement;
    expect(freshnessFill.style.width).toBe('100%');
  });

  it('progress bar fill is 0% for zero-scoring components', () => {
    render(<QualityScoreBreakdown item={poorItem} />);
    fireEvent.click(screen.getByRole('button'));

    const progressBars = screen.getAllByRole('progressbar');
    // For poor item, freshness is "expired" => raw 0 => 0%
    const freshnessFill = progressBars[0].firstElementChild as HTMLElement;
    expect(freshnessFill.style.width).toBe('0%');
  });

  // -------------------------------------------------------------------------
  // Missing / null data handling
  // -------------------------------------------------------------------------

  it('handles all-null item gracefully without errors', () => {
    expect(() => render(<QualityScoreBreakdown item={emptyItem} />)).not.toThrow();
  });

  it('handles empty object gracefully', () => {
    expect(() => render(<QualityScoreBreakdown item={{}} />)).not.toThrow();
  });

  it('shows correct breakdown for all-null item when expanded', () => {
    render(<QualityScoreBreakdown item={emptyItem} />);
    fireEvent.click(screen.getByRole('button'));

    const progressBars = screen.getAllByRole('progressbar');
    expect(progressBars).toHaveLength(5);

    // Freshness: null defaults to fresh => 30/30
    expect(progressBars[0]).toHaveAttribute('aria-valuenow', '30');
    // Confidence: null => 0
    expect(progressBars[1]).toHaveAttribute('aria-valuenow', '0');
    // Completeness: all null => 0
    expect(progressBars[2]).toHaveAttribute('aria-valuenow', '0');
    // Summary: null => 0
    expect(progressBars[3]).toHaveAttribute('aria-valuenow', '0');
    // Citations: undefined => 0
    expect(progressBars[4]).toHaveAttribute('aria-valuenow', '0');
  });

  // -------------------------------------------------------------------------
  // Section heading
  // -------------------------------------------------------------------------

  it('displays "Quality Score" as the section label', () => {
    render(<QualityScoreBreakdown item={excellentItem} />);
    expect(screen.getByText('Quality Score')).toBeInTheDocument();
  });
});
