/**
 * Composite quality score calculation for content items.
 *
 * Produces a single 0–100 score from five weighted components:
 *   Freshness (30%), Classification confidence (20%),
 *   Depth completeness (20%), Summary quality (15%),
 *   Citation history (15%).
 *
 * The score is designed for browse-card badges and governance dashboards.
 *
 * §5.5 Phase 5: freshness sub-score is additionally modulated by review-cadence
 * compliance when `next_review_date` is populated. Items without a
 * `next_review_date` produce identical scores to the pre-Phase 5 model — see
 * the null guard in `freshnessRaw`. Penalty schedule documented in
 * `docs/specs/p0-document-control-lifecycle-spec.md` §9.3.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QualityScoreInput {
  freshness?: string | null; // 'fresh' | 'ageing' | 'stale' | 'expired'
  classification_confidence?: number | null; // 0–1
  brief?: string | null;
  detail?: string | null;
  reference?: string | null;
  summary?: string | null;
  citation_count?: number; // from content_citations or metadata
  /** ISO date when the item is next due for review (DATE column). §5.5 Phase 5. */
  next_review_date?: string | null;
  /** Recurring review cadence in days (null = one-off review). §5.5 Phase 5. */
  review_cadence_days?: number | null;
}

export interface QualityScoreResult {
  score: number; // 0–100 (integer)
  components: {
    freshness: number; // weighted contribution (0–30)
    confidence: number; // weighted contribution (0–20)
    completeness: number; // weighted contribution (0–20)
    summary: number; // weighted contribution (0–15)
    citations: number; // weighted contribution (0–15)
  };
  label: 'Excellent' | 'Good' | 'Fair' | 'Needs Work' | 'Poor';
}

// ---------------------------------------------------------------------------
// Weights & look-ups
// ---------------------------------------------------------------------------

const WEIGHTS = {
  freshness: 0.3,
  confidence: 0.2,
  completeness: 0.2,
  summary: 0.15,
  citations: 0.15,
} as const;

/** Raw 0–100 value for each freshness state */
const FRESHNESS_SCORES: Record<string, number> = {
  fresh: 100,
  ageing: 60,
  aging: 60, // allow US spelling variant used in some DB rows
  stale: 30,
  expired: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Milliseconds in one day — used for cadence-compliance day arithmetic. */
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Compute the cadence-compliance penalty applied to the raw freshness score.
 *
 * Returns a non-negative integer to subtract from the base freshness value.
 * Penalty schedule (spec §9.3):
 *   - daysUntilDue > 30          → 0   (no penalty)
 *   - daysUntilDue 1..30         → 0..10 linear (graduated warning)
 *   - daysUntilDue ≤ 0, overdue ≤ 14 → 15
 *   - overdue 15..30             → 25
 *   - overdue > 30               → 40
 *
 * Boundary behaviour: `daysUntilDue === 0` is treated as overdue and falls
 * into the 1..14-day-overdue tier (-15), per spec §9.3 control flow.
 */
export function cadenceCompliancePenalty(
  nextReviewDate: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!nextReviewDate) return 0;

  const reviewTime = new Date(nextReviewDate).getTime();
  if (Number.isNaN(reviewTime)) return 0; // malformed date — fail open

  const daysUntilDue = Math.floor((reviewTime - now.getTime()) / MS_PER_DAY);

  if (daysUntilDue > 30) return 0;
  if (daysUntilDue > 0) {
    // Graduated warning band: -0 (at 30 days) up to -10 (at 1 day).
    return Math.round((1 - daysUntilDue / 30) * 10);
  }

  const daysOverdue = Math.abs(daysUntilDue);
  if (daysOverdue <= 14) return 15;
  if (daysOverdue <= 30) return 25;
  return 40;
}

function freshnessRaw(
  freshness: string | null | undefined,
  nextReviewDate?: string | null,
): number {
  const baseFreshness = !freshness
    ? 100 // new items default to fresh
    : (FRESHNESS_SCORES[freshness] ?? 100);

  // No cadence tracking — preserve pre-Phase 5 behaviour exactly.
  if (!nextReviewDate) return baseFreshness;

  const penalty = cadenceCompliancePenalty(nextReviewDate);
  return Math.max(baseFreshness - penalty, 0);
}

function confidenceRaw(value: number | null | undefined): number {
  if (value == null) return 0;
  // Clamp to 0–1 then scale to 0–100
  return Math.min(Math.max(value, 0), 1) * 100;
}

function completenessRaw(
  brief: string | null | undefined,
  detail: string | null | undefined,
  reference: string | null | undefined,
): number {
  let count = 0;
  if (brief && brief.trim().length > 0) count++;
  if (detail && detail.trim().length > 0) count++;
  if (reference && reference.trim().length > 0) count++;
  return (count / 3) * 100;
}

function summaryRaw(aiSummary: string | null | undefined): number {
  return aiSummary && aiSummary.trim().length > 0 ? 100 : 0;
}

function citationsRaw(count: number | undefined): number {
  return Math.min((count ?? 0) * 20, 100);
}

function labelForScore(
  score: number,
): 'Excellent' | 'Good' | 'Fair' | 'Needs Work' | 'Poor' {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Needs Work';
  return 'Poor';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper that returns only the integer score (0–100).
 * Used by API routes and cron jobs when storing the score in the database.
 */
export function calculateAndRoundQualityScore(
  input: QualityScoreInput,
): number {
  return calculateQualityScore(input).score;
}

export function calculateQualityScore(
  input: QualityScoreInput,
): QualityScoreResult {
  const rawFreshness = freshnessRaw(input.freshness, input.next_review_date);
  const rawConfidence = confidenceRaw(input.classification_confidence);
  const rawCompleteness = completenessRaw(
    input.brief,
    input.detail,
    input.reference,
  );
  const rawSummary = summaryRaw(input.summary);
  const rawCitations = citationsRaw(input.citation_count);

  const components = {
    freshness: Math.round(rawFreshness * WEIGHTS.freshness * 100) / 100,
    confidence: Math.round(rawConfidence * WEIGHTS.confidence * 100) / 100,
    completeness:
      Math.round(rawCompleteness * WEIGHTS.completeness * 100) / 100,
    summary: Math.round(rawSummary * WEIGHTS.summary * 100) / 100,
    citations: Math.round(rawCitations * WEIGHTS.citations * 100) / 100,
  };

  const score = Math.round(
    components.freshness +
      components.confidence +
      components.completeness +
      components.summary +
      components.citations,
  );

  return {
    score,
    components,
    label: labelForScore(score),
  };
}
