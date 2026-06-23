/**
 * QualityBadge — design-system contract test.
 *
 * This is the SINGLE intentional coupling point between the QualityBadge and
 * the Warm Meridian semantic colour tokens. The behaviour suite
 * (quality-badge.test.tsx) asserts user-observable state (visible score, label
 * text, accessible name); this file alone pins the score-band → semantic-token
 * mapping, so a token rename surfaces here rather than scattered across the
 * behaviour tests.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QualityBadge } from '@/components/shared/quality-badge';
import type { QualityScoreResult } from '@/lib/quality/quality-score';

function makeScore(
  score: number,
  label: QualityScoreResult['label'],
): QualityScoreResult {
  return {
    score,
    label,
    components: {
      freshness: 0,
      confidence: 0,
      completeness: 0,
      summary: 0,
      citations: 0,
    },
  };
}

const BANDS: Array<{
  score: number;
  label: QualityScoreResult['label'];
  text: string;
  bg: string;
}> = [
  {
    score: 85,
    label: 'Excellent',
    text: 'text-quality-good',
    bg: 'bg-quality-good-bg',
  },
  { score: 65, label: 'Good', text: 'text-primary', bg: 'bg-primary/10' },
  {
    score: 50,
    label: 'Fair',
    text: 'text-quality-moderate',
    bg: 'bg-quality-moderate-bg',
  },
  {
    score: 25,
    label: 'Needs Work',
    text: 'text-freshness-stale',
    bg: 'bg-freshness-stale-bg',
  },
  {
    score: 10,
    label: 'Poor',
    text: 'text-destructive',
    bg: 'bg-destructive/10',
  },
];

describe('QualityBadge — semantic token contract', () => {
  it.each(BANDS)(
    'maps the $label band to its semantic colour tokens',
    ({ score, label, text, bg }) => {
      const { container } = render(
        <QualityBadge score={makeScore(score, label)} />,
      );
      const badge = container.firstElementChild!;
      expect(badge.className).toContain(text);
      expect(badge.className).toContain(bg);
    },
  );
});
