/**
 * QualityScoreBreakdown — design-system contract test.
 *
 * Single intentional coupling point between the breakdown badge and the Warm
 * Meridian semantic colour tokens. The behaviour suite
 * (quality-score-breakdown.test.tsx) asserts the user-observable label per
 * score band; this file alone pins the label → semantic-token mapping.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QualityScoreBreakdown } from '@/components/shared/quality-score-breakdown';
import type { QualityScoreInput } from '@/lib/quality/quality-score';

const excellentItem: QualityScoreInput = {
  freshness: 'fresh',
  classification_confidence: 0.95,
  brief: 'Brief content here',
  detail: 'Detailed content here',
  reference: 'Reference content here',
  summary: 'This is an AI summary.',
  citation_count: 5,
};

const poorItem: QualityScoreInput = {
  freshness: 'expired',
  classification_confidence: 0,
  brief: null,
  detail: null,
  reference: null,
  summary: null,
  citation_count: 0,
};

describe('QualityScoreBreakdown — semantic token contract', () => {
  it('maps the Excellent band to its semantic colour tokens', () => {
    const { container } = render(
      <QualityScoreBreakdown item={excellentItem} />,
    );
    const badge = container.querySelector('.rounded-full');
    expect(badge?.className).toContain('text-quality-good');
    expect(badge?.className).toContain('bg-quality-good-bg');
  });

  it('maps the Poor band to its semantic colour tokens', () => {
    const { container } = render(<QualityScoreBreakdown item={poorItem} />);
    const badge = container.querySelector('.rounded-full');
    expect(badge?.className).toContain('text-destructive');
    expect(badge?.className).toContain('bg-destructive/10');
  });
});
