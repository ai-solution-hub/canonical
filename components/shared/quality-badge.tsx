'use client';

import { cn } from '@/lib/utils';
import type { QualityScoreResult } from '@/lib/quality/quality-score';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QualityBadgeProps {
  score: QualityScoreResult;
  size?: 'sm' | 'md';
  /** When true, show plain-language tooltip instead of component breakdown */
  simplified?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Colour mapping — semantic tokens only, no raw Tailwind colours
// ---------------------------------------------------------------------------

function getScoreClasses(score: number): { text: string; bg: string } {
  if (score >= 80)
    return { text: 'text-quality-good', bg: 'bg-quality-good-bg' };
  if (score >= 60) return { text: 'text-primary', bg: 'bg-primary/10' };
  if (score >= 40)
    return { text: 'text-quality-moderate', bg: 'bg-quality-moderate-bg' };
  if (score >= 20)
    return { text: 'text-freshness-stale', bg: 'bg-freshness-stale-bg' };
  return { text: 'text-destructive', bg: 'bg-destructive/10' };
}

// ---------------------------------------------------------------------------
// Breakdown tooltip text
// ---------------------------------------------------------------------------

function buildBreakdown(components: QualityScoreResult['components']): string {
  return [
    `Freshness: ${components.freshness}/30`,
    `Confidence: ${components.confidence}/20`,
    `Completeness: ${components.completeness}/20`,
    `Summary: ${components.summary}/15`,
    `Citations: ${components.citations}/15`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Compact quality score badge for content cards.
 *
 * WCAG 2.1 AA: pairs colour with a numeric score and text label —
 * never colour alone for meaning. Full breakdown in title and aria-label.
 *
 * When `simplified` is true, the tooltip shows a plain-language label
 * (e.g. "Quality: Good") instead of the full component breakdown.
 * This is intended for viewer/reader contexts where the detailed
 * breakdown is not actionable.
 */
export function QualityBadge({
  score,
  size = 'sm',
  simplified,
  className,
}: QualityBadgeProps) {
  const { text, bg } = getScoreClasses(score.score);
  const breakdown = buildBreakdown(score.components);

  const titleText = simplified ? `Quality: ${score.label}` : breakdown;
  const ariaText = simplified
    ? `Quality score: ${score.score} out of 100 — ${score.label}`
    : `Quality score: ${score.score} out of 100 — ${score.label}. ${breakdown}`;

  const isMd = size === 'md';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium tabular-nums',
        text,
        bg,
        isMd ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-0.5 text-[10px]',
        className,
      )}
      title={titleText}
      aria-label={ariaText}
    >
      <span className={cn('font-semibold', isMd ? 'text-xs' : 'text-[10px]')}>
        {score.score}
      </span>
      <span className={isMd ? 'text-[11px]' : 'text-[9px]'}>{score.label}</span>
    </span>
  );
}
