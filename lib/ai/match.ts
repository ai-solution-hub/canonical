import type { ConfidencePosture } from '@/types/procurement';

// Configurable similarity thresholds
export const MATCH_THRESHOLDS = {
  strong: 0.7, // 2+ results above this
  partial: 0.5, // 1+ results above this
  minimal: 0.3, // Below this = no content
};

export interface MatchResult {
  id: string;
  similarity: number;
  suggested_title?: string;
  content_type?: string;
}

/**
 * Assess confidence posture based on search result similarity scores.
 *
 * Grounding shape: n/a (B-INV-35,
 * AI_TOUCHPOINT_GROUNDING['match.assessConfidence']). This touchpoint is pure
 * scoring/deduplication over precomputed similarity values — it makes no AI
 * call, so it carries the `n/a` grounding shape.
 */
export function assessConfidence(matches: MatchResult[]): ConfidencePosture {
  const strongMatches = matches.filter(
    (m) => m.similarity >= MATCH_THRESHOLDS.strong,
  );
  const partialMatches = matches.filter(
    (m) => m.similarity >= MATCH_THRESHOLDS.partial,
  );

  if (strongMatches.length >= 2) return 'strong_match';
  if (partialMatches.length >= 1) return 'partial_match';
  if (matches.length > 0 && matches[0].similarity >= MATCH_THRESHOLDS.minimal)
    return 'needs_sme';
  return 'no_content';
}

/**
 * Deduplicate search results by content ID, keeping the highest similarity score.
 */
export function deduplicateResults(results: MatchResult[]): MatchResult[] {
  const seen = new Map<string, MatchResult>();
  for (const result of results) {
    const existing = seen.get(result.id);
    if (!existing || result.similarity > existing.similarity) {
      seen.set(result.id, result);
    }
  }
  return Array.from(seen.values()).sort((a, b) => b.similarity - a.similarity);
}
