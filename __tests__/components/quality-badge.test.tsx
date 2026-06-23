import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QualityBadge } from '@/components/shared/quality-badge';
import type { QualityScoreResult } from '@/lib/quality/quality-score';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScore(
  score: number,
  label: QualityScoreResult['label'],
  components?: Partial<QualityScoreResult['components']>,
): QualityScoreResult {
  return {
    score,
    label,
    components: {
      freshness: components?.freshness ?? 0,
      confidence: components?.confidence ?? 0,
      completeness: components?.completeness ?? 0,
      summary: components?.summary ?? 0,
      citations: components?.citations ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QualityBadge', () => {
  it('renders the score number', () => {
    render(<QualityBadge score={makeScore(75, 'Good')} />);
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('renders the label text', () => {
    render(<QualityBadge score={makeScore(75, 'Good')} />);
    expect(screen.getByText('Good')).toBeInTheDocument();
  });

  it('renders Excellent label for high scores', () => {
    render(<QualityBadge score={makeScore(92, 'Excellent')} />);
    expect(screen.getByText('Excellent')).toBeInTheDocument();
  });

  it('renders Poor label for low scores', () => {
    render(<QualityBadge score={makeScore(5, 'Poor')} />);
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Score band rendering — observable score + label per band.
  // The semantic-token colour mapping is asserted once in the dedicated
  // contract test (quality-badge.contract.test.tsx); here we assert the
  // user-observable score number, label text, and accessible name.
  // -------------------------------------------------------------------------

  it('shows score and Excellent label for a top-band score (85)', () => {
    render(<QualityBadge score={makeScore(85, 'Excellent')} />);
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('Excellent')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Quality score: 85 out of 100 — Excellent/),
    ).toBeInTheDocument();
  });

  it('shows score and Good label for a high-mid-band score (65)', () => {
    render(<QualityBadge score={makeScore(65, 'Good')} />);
    expect(screen.getByText('65')).toBeInTheDocument();
    expect(screen.getByText('Good')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Quality score: 65 out of 100 — Good/),
    ).toBeInTheDocument();
  });

  it('shows score and Fair label for a mid-band score (50)', () => {
    render(<QualityBadge score={makeScore(50, 'Fair')} />);
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('Fair')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Quality score: 50 out of 100 — Fair/),
    ).toBeInTheDocument();
  });

  it('shows score and Needs Work label for a low-mid-band score (25)', () => {
    render(<QualityBadge score={makeScore(25, 'Needs Work')} />);
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('Needs Work')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Quality score: 25 out of 100 — Needs Work/),
    ).toBeInTheDocument();
  });

  it('shows score and Poor label for a bottom-band score (10)', () => {
    render(<QualityBadge score={makeScore(10, 'Poor')} />);
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Poor')).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Quality score: 10 out of 100 — Poor/),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Accessibility
  // -------------------------------------------------------------------------

  it('has an aria-label with score, label, and breakdown', () => {
    const score = makeScore(75, 'Good', {
      freshness: 30,
      confidence: 16,
      completeness: 13,
      summary: 15,
      citations: 6,
    });
    const { container } = render(<QualityBadge score={score} />);
    const badge = container.firstElementChild!;
    expect(badge.getAttribute('aria-label')).toBe(
      'Quality score: 75 out of 100 — Good. Freshness: 30/30\nConfidence: 16/20\nCompleteness: 13/20\nSummary: 15/15\nCitations: 6/15',
    );
  });

  it('has a title attribute with the component breakdown', () => {
    const score = makeScore(50, 'Fair', {
      freshness: 18,
      confidence: 10,
      completeness: 7,
      summary: 15,
      citations: 0,
    });
    const { container } = render(<QualityBadge score={score} />);
    const badge = container.firstElementChild!;
    expect(badge.getAttribute('title')).toBe(
      'Freshness: 18/30\nConfidence: 10/20\nCompleteness: 7/20\nSummary: 15/15\nCitations: 0/15',
    );
  });

  // -------------------------------------------------------------------------
  // Size variants
  // -------------------------------------------------------------------------

  it('renders at compact size by default', () => {
    const { container } = render(
      <QualityBadge score={makeScore(75, 'Good')} />,
    );
    const badge = container.firstElementChild!;
    expect(badge.className).toContain('text-[10px]');
    expect(badge.className).toContain('px-1.5');
  });

  it('renders at a larger size when size="md"', () => {
    const { container } = render(
      <QualityBadge score={makeScore(75, 'Good')} size="md" />,
    );
    const badge = container.firstElementChild!;
    expect(badge.className).toContain('text-xs');
    expect(badge.className).toContain('px-2');
  });

  // -------------------------------------------------------------------------
  // Custom className
  // -------------------------------------------------------------------------

  it('accepts a custom className', () => {
    const { container } = render(
      <QualityBadge score={makeScore(75, 'Good')} className="ml-2" />,
    );
    const badge = container.firstElementChild!;
    expect(badge.className).toContain('ml-2');
  });

  // -------------------------------------------------------------------------
  // Boundary score rendering
  // -------------------------------------------------------------------------

  it('renders score of 0 correctly', () => {
    render(<QualityBadge score={makeScore(0, 'Poor')} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('Poor')).toBeInTheDocument();
  });

  it('renders score of 100 correctly', () => {
    render(<QualityBadge score={makeScore(100, 'Excellent')} />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Excellent')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Simplified mode (plain-language tooltip for viewers/reader mode)
  // -------------------------------------------------------------------------

  it('shows plain-language title when simplified is true', () => {
    const score = makeScore(75, 'Good', {
      freshness: 30,
      confidence: 16,
      completeness: 13,
      summary: 15,
      citations: 6,
    });
    const { container } = render(<QualityBadge score={score} simplified />);
    const badge = container.firstElementChild!;
    expect(badge.getAttribute('title')).toBe('Quality: Good');
  });

  it('shows simplified aria-label without breakdown when simplified is true', () => {
    const score = makeScore(72, 'Good', {
      freshness: 25,
      confidence: 14,
      completeness: 12,
      summary: 12,
      citations: 9,
    });
    render(<QualityBadge score={score} simplified />);
    const badge = screen.getByLabelText('Quality score: 72 out of 100 — Good');
    expect(badge).toBeInTheDocument();
  });

  it('shows full breakdown title when simplified is false', () => {
    const score = makeScore(50, 'Fair', {
      freshness: 18,
      confidence: 10,
      completeness: 7,
      summary: 15,
      citations: 0,
    });
    const { container } = render(
      <QualityBadge score={score} simplified={false} />,
    );
    const badge = container.firstElementChild!;
    expect(badge.getAttribute('title')).toBe(
      'Freshness: 18/30\nConfidence: 10/20\nCompleteness: 7/20\nSummary: 15/15\nCitations: 0/15',
    );
  });

  it('shows full breakdown title when simplified is omitted (default)', () => {
    const score = makeScore(65, 'Good', {
      freshness: 20,
      confidence: 15,
      completeness: 10,
      summary: 10,
      citations: 10,
    });
    const { container } = render(<QualityBadge score={score} />);
    const badge = container.firstElementChild!;
    expect(badge.getAttribute('title')).toBe(
      'Freshness: 20/30\nConfidence: 15/20\nCompleteness: 10/20\nSummary: 10/15\nCitations: 10/15',
    );
  });

  it('still renders score and label visually when simplified', () => {
    render(<QualityBadge score={makeScore(85, 'Excellent')} simplified />);
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByText('Excellent')).toBeInTheDocument();
  });
});
