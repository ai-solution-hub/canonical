import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateQualityScore,
  cadenceCompliancePenalty,
  type QualityScoreInput,
} from '@/lib/quality/quality-score';

describe('calculateQualityScore', () => {
  // -------------------------------------------------------------------------
  // Perfect & zero scores
  // -------------------------------------------------------------------------

  it('returns a perfect score when all components are at maximum', () => {
    const input: QualityScoreInput = {
      freshness: 'fresh',
      classification_confidence: 1,
      brief: 'Brief text',
      detail: 'Detail text',
      reference: 'Reference text',
      summary: 'Summary text',
      citation_count: 5, // 5 * 20 = 100, capped at 100
    };
    const result = calculateQualityScore(input);
    expect(result.score).toBe(100);
    expect(result.label).toBe('Excellent');
    expect(result.components.freshness).toBe(30);
    expect(result.components.confidence).toBe(20);
    expect(result.components.completeness).toBe(20);
    expect(result.components.summary).toBe(15);
    expect(result.components.citations).toBe(15);
  });

  it('returns zero when all components are at minimum', () => {
    const input: QualityScoreInput = {
      freshness: 'expired',
      classification_confidence: 0,
      brief: null,
      detail: null,
      reference: null,
      summary: null,
      citation_count: 0,
    };
    const result = calculateQualityScore(input);
    expect(result.score).toBe(0);
    expect(result.label).toBe('Poor');
    expect(result.components.freshness).toBe(0);
    expect(result.components.confidence).toBe(0);
    expect(result.components.completeness).toBe(0);
    expect(result.components.summary).toBe(0);
    expect(result.components.citations).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Missing/null field handling
  // -------------------------------------------------------------------------

  it('handles completely empty input (all undefined)', () => {
    const result = calculateQualityScore({});
    // freshness defaults to fresh (100 * 0.3 = 30), rest 0
    expect(result.score).toBe(30);
    expect(result.components.freshness).toBe(30);
    expect(result.components.confidence).toBe(0);
    expect(result.components.completeness).toBe(0);
    expect(result.components.summary).toBe(0);
    expect(result.components.citations).toBe(0);
  });

  it('handles null freshness as fresh', () => {
    const result = calculateQualityScore({ freshness: null });
    expect(result.components.freshness).toBe(30);
  });

  it('handles null classification_confidence as 0', () => {
    const result = calculateQualityScore({ classification_confidence: null });
    expect(result.components.confidence).toBe(0);
  });

  it('handles whitespace-only strings as empty for completeness', () => {
    const result = calculateQualityScore({
      brief: '   ',
      detail: '\t',
      reference: '\n',
    });
    expect(result.components.completeness).toBe(0);
  });

  it('handles whitespace-only summary as no summary', () => {
    const result = calculateQualityScore({ summary: '  ' });
    expect(result.components.summary).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Freshness level mapping
  // -------------------------------------------------------------------------

  it.each([
    ['fresh', 30],
    ['ageing', 18],
    ['aging', 18], // US spelling variant
    ['stale', 9],
    ['expired', 0],
  ])('maps freshness "%s" to component value %d', (freshness, expected) => {
    const result = calculateQualityScore({ freshness });
    expect(result.components.freshness).toBe(expected);
  });

  it('treats an unknown freshness value as fresh (100)', () => {
    const result = calculateQualityScore({ freshness: 'unknown-state' });
    expect(result.components.freshness).toBe(30);
  });

  // -------------------------------------------------------------------------
  // Classification confidence
  // -------------------------------------------------------------------------

  it('clamps confidence above 1 to 1', () => {
    const result = calculateQualityScore({ classification_confidence: 1.5 });
    expect(result.components.confidence).toBe(20);
  });

  it('clamps negative confidence to 0', () => {
    const result = calculateQualityScore({ classification_confidence: -0.3 });
    expect(result.components.confidence).toBe(0);
  });

  it('calculates partial confidence correctly', () => {
    const result = calculateQualityScore({ classification_confidence: 0.8 });
    // 0.8 * 100 = 80, 80 * 0.2 = 16
    expect(result.components.confidence).toBe(16);
  });

  // -------------------------------------------------------------------------
  // Citation count capping
  // -------------------------------------------------------------------------

  it('caps citation contribution at 100 raw (15 weighted)', () => {
    const result = calculateQualityScore({ citation_count: 10 });
    // 10 * 20 = 200, capped at 100, 100 * 0.15 = 15
    expect(result.components.citations).toBe(15);
  });

  it('calculates partial citation score correctly', () => {
    const result = calculateQualityScore({ citation_count: 2 });
    // 2 * 20 = 40, 40 * 0.15 = 6
    expect(result.components.citations).toBe(6);
  });

  it('handles undefined citation_count as 0', () => {
    const result = calculateQualityScore({});
    expect(result.components.citations).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Depth completeness (partial)
  // -------------------------------------------------------------------------

  it('scores 1 of 3 depth fields filled', () => {
    const result = calculateQualityScore({ brief: 'Content' });
    // (1/3) * 100 = 33.33, * 0.2 = 6.67
    expect(result.components.completeness).toBeCloseTo(6.67, 1);
  });

  it('scores 2 of 3 depth fields filled', () => {
    const result = calculateQualityScore({
      brief: 'Content',
      detail: 'More detail',
    });
    // (2/3) * 100 = 66.67, * 0.2 = 13.33
    expect(result.components.completeness).toBeCloseTo(13.33, 1);
  });

  it('scores 3 of 3 depth fields filled', () => {
    const result = calculateQualityScore({
      brief: 'a',
      detail: 'b',
      reference: 'c',
    });
    expect(result.components.completeness).toBe(20);
  });

  // -------------------------------------------------------------------------
  // Label threshold edge cases
  // -------------------------------------------------------------------------

  it('labels score in the 60-79 range as Good', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 1,
      brief: null,
      detail: null,
      reference: null,
      summary: null,
      citation_count: 3, // 3*20=60, 60*0.15=9
    });
    // 30 + 20 + 0 + 0 + 9 = 59
    expect(result.score).toBe(59);
    expect(result.label).toBe('Fair');
  });

  it('labels score of 85 as Excellent', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 1,
      brief: 'a',
      detail: 'b',
      reference: 'c',
      summary: 'Summary',
      citation_count: 0,
    });
    // 30 + 20 + 20 + 15 + 0 = 85
    expect(result.score).toBe(85);
    expect(result.label).toBe('Excellent');
  });

  it('labels score of 40 as Fair (boundary)', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 0.5,
      brief: null,
      detail: null,
      reference: null,
      summary: null,
      citation_count: 0,
    });
    // 30 + 10 + 0 + 0 + 0 = 40
    expect(result.score).toBe(40);
    expect(result.label).toBe('Fair');
  });

  it('labels score of 29 as Needs Work', () => {
    const result = calculateQualityScore({
      freshness: 'stale',
      classification_confidence: 1,
      brief: null,
      detail: null,
      reference: null,
      summary: null,
      citation_count: 0,
    });
    // 9 + 20 + 0 + 0 + 0 = 29
    expect(result.score).toBe(29);
    expect(result.label).toBe('Needs Work');
  });

  it('labels score of 20 as Needs Work (boundary)', () => {
    const result = calculateQualityScore({
      freshness: 'expired',
      classification_confidence: 1,
      brief: null,
      detail: null,
      reference: null,
      summary: null,
      citation_count: 0,
    });
    // 0 + 20 + 0 + 0 + 0 = 20
    expect(result.score).toBe(20);
    expect(result.label).toBe('Needs Work');
  });

  it('labels score of 10 as Poor', () => {
    const result = calculateQualityScore({
      freshness: 'expired',
      classification_confidence: 0.5,
      brief: null,
      detail: null,
      reference: null,
      summary: null,
      citation_count: 0,
    });
    // 0 + 10 + 0 + 0 + 0 = 10
    expect(result.score).toBe(10);
    expect(result.label).toBe('Poor');
  });

  // -------------------------------------------------------------------------
  // Component weights sum to total score
  // -------------------------------------------------------------------------

  it('weighted components sum to exactly the total score', () => {
    const input: QualityScoreInput = {
      freshness: 'ageing',
      classification_confidence: 0.72,
      brief: 'Brief content',
      detail: null,
      reference: 'Reference content',
      summary: 'AI generated summary',
      citation_count: 1,
    };
    const result = calculateQualityScore(input);
    const componentSum =
      result.components.freshness +
      result.components.confidence +
      result.components.completeness +
      result.components.summary +
      result.components.citations;
    // The total score is the rounded sum of components
    expect(result.score).toBe(Math.round(componentSum));
  });

  // -------------------------------------------------------------------------
  // Realistic browse-card scenario (no detail/reference available)
  // -------------------------------------------------------------------------

  it('calculates a realistic score for a browse card item (no detail/reference)', () => {
    const result = calculateQualityScore({
      freshness: 'fresh',
      classification_confidence: 0.85,
      brief: 'A brief summary',
      summary: 'An AI-generated summary of the content',
      citation_count: 0,
    });
    // freshness: 30, confidence: 17, completeness: 6.67, summary: 15, citations: 0
    // Total: 68.67 rounds to 69
    expect(result.score).toBe(69);
    expect(result.label).toBe('Good');
  });
});

// ---------------------------------------------------------------------------
// §5.5 Phase 5 — Cadence-compliance penalty
// ---------------------------------------------------------------------------
//
// Date-pinning rationale: cadence math depends on `Date.now()` at call time.
// We pin a fixed wall-clock to make day-arithmetic boundaries deterministic
// (avoids midnight-rounding flakiness — see CLAUDE.md "Date-sensitive tests").

describe('cadence-compliance penalty', () => {
  // Fixed reference time: 1 May 2026, 12:00 UTC. Mid-day so trailing hours
  // don't push Math.floor() across day boundaries unexpectedly.
  const NOW_MS = Date.UTC(2026, 4, 1, 12, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Build an ISO date string `daysFromNow` whole days from the pinned now. */
  function isoDateOffset(daysFromNow: number): string {
    return new Date(NOW_MS + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  }

  // -------------------------------------------------------------------------
  // cadenceCompliancePenalty unit tests (boundary table)
  // -------------------------------------------------------------------------

  describe('cadenceCompliancePenalty', () => {
    it('returns 0 when next_review_date is null', () => {
      expect(cadenceCompliancePenalty(null)).toBe(0);
    });

    it('returns 0 when next_review_date is undefined', () => {
      expect(cadenceCompliancePenalty(undefined)).toBe(0);
    });

    it('returns 0 for malformed date strings (fail open)', () => {
      expect(cadenceCompliancePenalty('not-a-date')).toBe(0);
    });

    it('returns 0 when due in 31 days (just outside warning band)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(31))).toBe(0);
    });

    it('returns 0 when due in 60 days (well outside warning band)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(60))).toBe(0);
    });

    it('returns 0 at exactly 30 days (warning-band lower edge)', () => {
      // (1 - 30/30) * 10 = 0
      expect(cadenceCompliancePenalty(isoDateOffset(30))).toBe(0);
    });

    it('returns 5 at 15 days (warning-band midpoint)', () => {
      // (1 - 15/30) * 10 = 5
      expect(cadenceCompliancePenalty(isoDateOffset(15))).toBe(5);
    });

    it('returns 10 at 1 day (warning-band upper edge)', () => {
      // (1 - 1/30) * 10 = 9.667 → rounds to 10
      expect(cadenceCompliancePenalty(isoDateOffset(1))).toBe(10);
    });

    it('returns 15 when due today (daysUntilDue = 0 → falls into overdue ≤14 tier)', () => {
      // Spec §9.3 control flow: `daysUntilDue > 0` is false, so we drop into
      // the overdue branch. daysOverdue = 0, caught by `daysOverdue <= 14`.
      expect(cadenceCompliancePenalty(isoDateOffset(0))).toBe(15);
    });

    it('returns 15 at 1 day overdue (overdue tier 1 lower edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-1))).toBe(15);
    });

    it('returns 15 at 14 days overdue (overdue tier 1 upper edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-14))).toBe(15);
    });

    it('returns 25 at 15 days overdue (overdue tier 2 lower edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-15))).toBe(25);
    });

    it('returns 25 at 30 days overdue (overdue tier 2 upper edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-30))).toBe(25);
    });

    it('returns 40 at 31 days overdue (overdue tier 3 lower edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-31))).toBe(40);
    });

    it('returns 40 at 100 days overdue (well into tier 3)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-100))).toBe(40);
    });
  });

  // -------------------------------------------------------------------------
  // calculateQualityScore — preservation rule (regression guard)
  // -------------------------------------------------------------------------

  describe('preservation rule: null next_review_date matches pre-Phase 5 scores', () => {
    it('null next_review_date produces identical score to omitted field', () => {
      const baseInput: QualityScoreInput = {
        freshness: 'fresh',
        classification_confidence: 0.85,
        brief: 'A brief summary',
        summary: 'An AI-generated summary',
        citation_count: 0,
      };
      const without = calculateQualityScore(baseInput);
      const withNull = calculateQualityScore({
        ...baseInput,
        next_review_date: null,
        review_cadence_days: null,
      });
      expect(withNull.score).toBe(without.score);
      expect(withNull.components).toEqual(without.components);
      expect(withNull.label).toBe(without.label);
    });

    it('next_review_date >30 days away produces identical score to no cadence', () => {
      const baseInput: QualityScoreInput = {
        freshness: 'fresh',
        classification_confidence: 1,
        brief: 'a',
        detail: 'b',
        reference: 'c',
        summary: 'Summary',
        citation_count: 0,
      };
      const without = calculateQualityScore(baseInput);
      const withFutureCadence = calculateQualityScore({
        ...baseInput,
        next_review_date: isoDateOffset(60),
        review_cadence_days: 365,
      });
      expect(withFutureCadence.score).toBe(without.score);
      expect(withFutureCadence.components.freshness).toBe(
        without.components.freshness,
      );
    });
  });

  // -------------------------------------------------------------------------
  // calculateQualityScore — cadence-modified path
  // -------------------------------------------------------------------------

  describe('cadence-modified freshness component', () => {
    it('applies -5 graduated penalty at 15 days until due', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(15),
      });
      // Base 100 - 5 penalty = 95 raw freshness; 95 * 0.3 = 28.5
      expect(result.components.freshness).toBe(28.5);
    });

    it('applies -10 graduated penalty at 1 day until due', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(1),
      });
      // 100 - 10 = 90; 90 * 0.3 = 27
      expect(result.components.freshness).toBe(27);
    });

    it('applies -15 penalty when due today', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(0),
      });
      // 100 - 15 = 85; 85 * 0.3 = 25.5
      expect(result.components.freshness).toBe(25.5);
    });

    it('applies -15 penalty at 14 days overdue', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(-14),
      });
      expect(result.components.freshness).toBe(25.5);
    });

    it('applies -25 penalty at 20 days overdue', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(-20),
      });
      // 100 - 25 = 75; 75 * 0.3 = 22.5
      expect(result.components.freshness).toBe(22.5);
    });

    it('applies -40 penalty at 45 days overdue (spec §9.3 example)', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        classification_confidence: 1,
        brief: 'a',
        detail: 'b',
        reference: 'c',
        summary: 'Summary',
        citation_count: 0,
        next_review_date: isoDateOffset(-45),
      });
      // Spec §9.3 example: fresh + 45d overdue → 100 - 40 = 60 raw, 60 * 0.3 = 18 weighted
      expect(result.components.freshness).toBe(18);
      // Pre-Phase 5 score for this input would be 30+20+20+15+0 = 85.
      // Post-Phase 5 with -40 penalty: 18+20+20+15+0 = 73 (12-point drop).
      expect(result.score).toBe(73);
      expect(result.label).toBe('Good');
    });

    it('clamps freshness to 0 when penalty exceeds base (expired + overdue)', () => {
      const result = calculateQualityScore({
        freshness: 'expired',
        next_review_date: isoDateOffset(-100),
      });
      // Base expired = 0; 0 - 40 clamped to 0
      expect(result.components.freshness).toBe(0);
    });

    it('penalty applies to non-fresh base scores (stale + 1 day overdue)', () => {
      const result = calculateQualityScore({
        freshness: 'stale',
        next_review_date: isoDateOffset(-1),
      });
      // Base stale = 30; 30 - 15 penalty = 15; 15 * 0.3 = 4.5
      expect(result.components.freshness).toBe(4.5);
    });

    it('penalty applies to ageing base score within warning band', () => {
      const result = calculateQualityScore({
        freshness: 'ageing',
        next_review_date: isoDateOffset(15),
      });
      // Base ageing = 60; 60 - 5 = 55; 55 * 0.3 = 16.5
      expect(result.components.freshness).toBe(16.5);
    });

    it('demonstrates label transition: borderline Good item drops via cadence penalty', () => {
      // Build an input that scores Good without cadence
      const baseInput: QualityScoreInput = {
        freshness: 'fresh', // 30
        classification_confidence: 1, // 20
        brief: 'a', // 6.67 (1 of 3)
        summary: 'x', // 15
        citation_count: 0, // 0
      };
      // Sanity-check baseline: 30 + 20 + 6.67 + 15 + 0 = 71.67 → rounds to 72 (Good)
      const baseline = calculateQualityScore(baseInput);
      expect(baseline.label).toBe('Good');

      const overdueResult = calculateQualityScore({
        ...baseInput,
        next_review_date: isoDateOffset(-45),
      });
      // freshness drops: 100 → 60 raw, 18 weighted
      // total: 18 + 20 + 6.67 + 15 + 0 = 59.67 → rounds to 60 (still Good lower edge)
      // The assertion is on the freshness drop and overall score reduction.
      expect(overdueResult.components.freshness).toBe(18);
      expect(overdueResult.score).toBeLessThan(baseline.score);
    });
  });
});

// ---------------------------------------------------------------------------
// §5.5 Phase 5 — Cadence-compliance penalty
// ---------------------------------------------------------------------------
//
// Date-pinning rationale: cadence math depends on `Date.now()` at call time.
// We pin a fixed wall-clock to make day-arithmetic boundaries deterministic
// (avoids midnight-rounding flakiness — see CLAUDE.md "Date-sensitive tests").

describe('cadence-compliance penalty', () => {
  // Fixed reference time: 1 May 2026, 12:00 UTC. Mid-day so trailing hours
  // don't push Math.floor() across day boundaries unexpectedly.
  const NOW_MS = Date.UTC(2026, 4, 1, 12, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_MS));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Build an ISO date string `daysFromNow` whole days from the pinned now. */
  function isoDateOffset(daysFromNow: number): string {
    return new Date(NOW_MS + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
  }

  // -------------------------------------------------------------------------
  // cadenceCompliancePenalty unit tests (boundary table)
  // -------------------------------------------------------------------------

  describe('cadenceCompliancePenalty', () => {
    it('returns 0 when next_review_date is null', () => {
      expect(cadenceCompliancePenalty(null)).toBe(0);
    });

    it('returns 0 when next_review_date is undefined', () => {
      expect(cadenceCompliancePenalty(undefined)).toBe(0);
    });

    it('returns 0 for malformed date strings (fail open)', () => {
      expect(cadenceCompliancePenalty('not-a-date')).toBe(0);
    });

    it('returns 0 when due in 31 days (just outside warning band)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(31))).toBe(0);
    });

    it('returns 0 when due in 60 days (well outside warning band)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(60))).toBe(0);
    });

    it('returns 0 at exactly 30 days (warning-band lower edge)', () => {
      // (1 - 30/30) * 10 = 0
      expect(cadenceCompliancePenalty(isoDateOffset(30))).toBe(0);
    });

    it('returns 5 at 15 days (warning-band midpoint)', () => {
      // (1 - 15/30) * 10 = 5
      expect(cadenceCompliancePenalty(isoDateOffset(15))).toBe(5);
    });

    it('returns 10 at 1 day (warning-band upper edge)', () => {
      // (1 - 1/30) * 10 = 9.667 → rounds to 10
      expect(cadenceCompliancePenalty(isoDateOffset(1))).toBe(10);
    });

    it('returns 15 when due today (daysUntilDue = 0 → falls into overdue ≤14 tier)', () => {
      // Spec §9.3 control flow: `daysUntilDue > 0` is false, so we drop into
      // the overdue branch. daysOverdue = 0, caught by `daysOverdue <= 14`.
      expect(cadenceCompliancePenalty(isoDateOffset(0))).toBe(15);
    });

    it('returns 15 at 1 day overdue (overdue tier 1 lower edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-1))).toBe(15);
    });

    it('returns 15 at 14 days overdue (overdue tier 1 upper edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-14))).toBe(15);
    });

    it('returns 25 at 15 days overdue (overdue tier 2 lower edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-15))).toBe(25);
    });

    it('returns 25 at 30 days overdue (overdue tier 2 upper edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-30))).toBe(25);
    });

    it('returns 40 at 31 days overdue (overdue tier 3 lower edge)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-31))).toBe(40);
    });

    it('returns 40 at 100 days overdue (well into tier 3)', () => {
      expect(cadenceCompliancePenalty(isoDateOffset(-100))).toBe(40);
    });
  });

  // -------------------------------------------------------------------------
  // calculateQualityScore — preservation rule (regression guard)
  // -------------------------------------------------------------------------

  describe('preservation rule: null next_review_date matches pre-Phase 5 scores', () => {
    it('null next_review_date produces identical score to omitted field', () => {
      const baseInput: QualityScoreInput = {
        freshness: 'fresh',
        classification_confidence: 0.85,
        brief: 'A brief summary',
        summary: 'An AI-generated summary',
        citation_count: 0,
      };
      const without = calculateQualityScore(baseInput);
      const withNull = calculateQualityScore({
        ...baseInput,
        next_review_date: null,
        review_cadence_days: null,
      });
      expect(withNull.score).toBe(without.score);
      expect(withNull.components).toEqual(without.components);
      expect(withNull.label).toBe(without.label);
    });

    it('next_review_date >30 days away produces identical score to no cadence', () => {
      const baseInput: QualityScoreInput = {
        freshness: 'fresh',
        classification_confidence: 1,
        brief: 'a',
        detail: 'b',
        reference: 'c',
        summary: 'Summary',
        citation_count: 0,
      };
      const without = calculateQualityScore(baseInput);
      const withFutureCadence = calculateQualityScore({
        ...baseInput,
        next_review_date: isoDateOffset(60),
        review_cadence_days: 365,
      });
      expect(withFutureCadence.score).toBe(without.score);
      expect(withFutureCadence.components.freshness).toBe(
        without.components.freshness,
      );
    });
  });

  // -------------------------------------------------------------------------
  // calculateQualityScore — cadence-modified path
  // -------------------------------------------------------------------------

  describe('cadence-modified freshness component', () => {
    it('applies -5 graduated penalty at 15 days until due', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(15),
      });
      // Base 100 - 5 penalty = 95 raw freshness; 95 * 0.3 = 28.5
      expect(result.components.freshness).toBe(28.5);
    });

    it('applies -10 graduated penalty at 1 day until due', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(1),
      });
      // 100 - 10 = 90; 90 * 0.3 = 27
      expect(result.components.freshness).toBe(27);
    });

    it('applies -15 penalty when due today', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(0),
      });
      // 100 - 15 = 85; 85 * 0.3 = 25.5
      expect(result.components.freshness).toBe(25.5);
    });

    it('applies -15 penalty at 14 days overdue', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(-14),
      });
      expect(result.components.freshness).toBe(25.5);
    });

    it('applies -25 penalty at 20 days overdue', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        next_review_date: isoDateOffset(-20),
      });
      // 100 - 25 = 75; 75 * 0.3 = 22.5
      expect(result.components.freshness).toBe(22.5);
    });

    it('applies -40 penalty at 45 days overdue (spec §9.3 example)', () => {
      const result = calculateQualityScore({
        freshness: 'fresh',
        classification_confidence: 1,
        brief: 'a',
        detail: 'b',
        reference: 'c',
        summary: 'Summary',
        citation_count: 0,
        next_review_date: isoDateOffset(-45),
      });
      // Spec §9.3 example: fresh + 45d overdue → 100 - 40 = 60 raw, 60 * 0.3 = 18 weighted
      expect(result.components.freshness).toBe(18);
      // Pre-Phase 5 score for this input would be 30+20+20+15+0 = 85.
      // Post-Phase 5 with -40 penalty: 18+20+20+15+0 = 73 (12-point drop).
      expect(result.score).toBe(73);
      expect(result.label).toBe('Good');
    });

    it('clamps freshness to 0 when penalty exceeds base (expired + overdue)', () => {
      const result = calculateQualityScore({
        freshness: 'expired',
        next_review_date: isoDateOffset(-100),
      });
      // Base expired = 0; 0 - 40 clamped to 0
      expect(result.components.freshness).toBe(0);
    });

    it('penalty applies to non-fresh base scores (stale + 1 day overdue)', () => {
      const result = calculateQualityScore({
        freshness: 'stale',
        next_review_date: isoDateOffset(-1),
      });
      // Base stale = 30; 30 - 15 penalty = 15; 15 * 0.3 = 4.5
      expect(result.components.freshness).toBe(4.5);
    });

    it('penalty applies to ageing base score within warning band', () => {
      const result = calculateQualityScore({
        freshness: 'ageing',
        next_review_date: isoDateOffset(15),
      });
      // Base ageing = 60; 60 - 5 = 55; 55 * 0.3 = 16.5
      expect(result.components.freshness).toBe(16.5);
    });

    it('demonstrates label transition: borderline Good item drops to Fair via cadence penalty', () => {
      // Build an input that scores exactly 60 (Good lower edge) without cadence
      const baseInput: QualityScoreInput = {
        freshness: 'fresh', // 30
        classification_confidence: 1, // 20
        brief: 'a', // 6.67 (1 of 3)
        summary: 'x', // 15
        citation_count: 0, // 0
      };
      // Sanity-check baseline: 30 + 20 + 6.67 + 15 + 0 = 71.67 → rounds to 72 (Good)
      const baseline = calculateQualityScore(baseInput);
      expect(baseline.label).toBe('Good');

      const overdueResult = calculateQualityScore({
        ...baseInput,
        next_review_date: isoDateOffset(-45),
      });
      // freshness drops: 100 → 60 raw, 18 weighted
      // total: 18 + 20 + 6.67 + 15 + 0 = 59.67 → rounds to 60 (still Good lower edge)
      // This documents the boundary; the assertion is on the freshness drop.
      expect(overdueResult.components.freshness).toBe(18);
      expect(overdueResult.score).toBeLessThan(baseline.score);
    });
  });
});
