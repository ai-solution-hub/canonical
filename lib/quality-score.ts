/**
 * Composite quality score calculation for content items.
 *
 * Produces a single 0–100 score from five weighted components:
 *   Freshness (30%), Classification confidence (20%),
 *   Depth completeness (20%), Summary quality (15%),
 *   Citation history (15%).
 *
 * The score is designed for browse-card badges and governance dashboards.
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
  ai_summary?: string | null;
  citation_count?: number; // from content_citations or metadata
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

function freshnessRaw(freshness: string | null | undefined): number {
  if (!freshness) return 100; // new items default to fresh
  return FRESHNESS_SCORES[freshness] ?? 100;
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
  const rawFreshness = freshnessRaw(input.freshness);
  const rawConfidence = confidenceRaw(input.classification_confidence);
  const rawCompleteness = completenessRaw(
    input.brief,
    input.detail,
    input.reference,
  );
  const rawSummary = summaryRaw(input.ai_summary);
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
