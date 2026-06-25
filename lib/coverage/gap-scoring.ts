/**
 * Priority scoring for unified gaps.
 *
 * Produces a 0-100 score for each gap based on source-specific signals.
 * Phase 1 excludes bid-deadline scoring (deferred to Phase 4).
 *
 * Tiers:
 *   Critical  75-100  (reserved for Phase 4 bid-deadline gaps)
 *   High      50-74
 *   Medium    25-49
 *   Low        0-24
 *
 * Spec: .planning/specs/gaps-view-consolidation-spec.md §4
 */

import type {
  UnifiedGap,
  PriorityTier,
} from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// Template type weight lookup
// ---------------------------------------------------------------------------

/** Template type weighting — gateway stages (SQ/PSQ) rank highest. */
const TEMPLATE_TYPE_WEIGHTS: Record<string, number> = {
  sq: 10,
  psq: 10,
  itt: 7,
  rfp: 7,
};
const DEFAULT_TEMPLATE_TYPE_WEIGHT = 3;

/**
 * Get the template type score for a given template type string.
 * SQ/PSQ = 10, ITT/RFP = 7, everything else = 3.
 */
export function getTemplateTypeWeight(templateType: string): number {
  return TEMPLATE_TYPE_WEIGHTS[templateType.toLowerCase()] ?? DEFAULT_TEMPLATE_TYPE_WEIGHT;
}

// ---------------------------------------------------------------------------
// Priority tier derivation
// ---------------------------------------------------------------------------

/** Derive a priority tier from a numeric score. */
export function derivePriorityTier(score: number): PriorityTier {
  if (score >= 75) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// Per-source scoring functions
// ---------------------------------------------------------------------------

/** Input signals for scoring a taxonomy gap (before score is computed). */
/** @public */
export interface TaxonomyGapInput {
  /** Whether a coverage target exists for this domain and is unmet */
  target_unmet: boolean;
  /** Whether the entire domain has zero content items across all subtopics */
  domain_has_zero_items: boolean;
}

/**
 * Compute priority score for a taxonomy gap.
 *
 * Formula: 25 (base) + (target_unmet ? 15 : 0) + (domain_has_zero_items ? 10 : 0)
 * Range: 25-50
 */
export function scoreTaxonomyGap(input: TaxonomyGapInput): number {
  let score = 25;
  if (input.target_unmet) score += 15;
  if (input.domain_has_zero_items) score += 10;
  return score;
}

/** Input signals for scoring a template gap (before score is computed). */
/** @public */
export interface TemplateGapInput {
  /** Whether the requirement is mandatory (null treated as false) */
  is_mandatory: boolean | null;
  /** Template type string (e.g. 'SQ', 'PSQ', 'ITT', 'RFP') */
  template_type: string;
  /** Whether this gap has persisted for 3+ consecutive weeks */
  is_persistent_gap: boolean;
}

/**
 * Compute priority score for a template gap.
 *
 * Formula: 20 (base) + (is_mandatory ? 15 : 0) + template_type_score + (persistent ? 10 : 0)
 * Range: 20-55
 */
export function scoreTemplateGap(input: TemplateGapInput): number {
  let score = 20;
  if (input.is_mandatory === true) score += 15;
  score += getTemplateTypeWeight(input.template_type);
  if (input.is_persistent_gap) score += 10;
  return score;
}

/** Input signals for scoring a guide gap (before score is computed). */
/** @public */
export interface GuideGapInput {
  /** Whether the section is marked as required */
  is_required: boolean;
  /** Section status: 'empty' or 'stale' */
  section_status: 'empty' | 'stale';
}

/**
 * Compute priority score for a guide gap.
 *
 * Formula: 15 (base) + (is_required ? 15 : 0) + (stale ? 5 : 0)
 * Range: 15-35
 */
export function scoreGuideGap(input: GuideGapInput): number {
  let score = 15;
  if (input.is_required) score += 15;
  if (input.section_status === 'stale') score += 5;
  return score;
}

// ---------------------------------------------------------------------------
// Unified scoring
// ---------------------------------------------------------------------------

/**
 * Score a fully-formed UnifiedGap and update its priority_score + priority_tier.
 * This is used after the gap object is constructed with initial data.
 *
 * For taxonomy gaps, requires additional context about domain-level emptiness
 * that must be passed separately.
 */
export function scoreGap(
  gap: UnifiedGap,
  context?: { domain_has_zero_items?: boolean },
): UnifiedGap {
  let score = 0;

  switch (gap.source) {
    case 'taxonomy':
      score = scoreTaxonomyGap({
        target_unmet: gap.target_unmet,
        domain_has_zero_items: context?.domain_has_zero_items ?? false,
      });
      break;

    case 'template':
      score = scoreTemplateGap({
        is_mandatory: gap.is_mandatory,
        template_type: gap.template_type,
        // Phase 1: persistent gap detection not yet implemented
        is_persistent_gap: false,
      });
      break;

    case 'guide':
      score = scoreGuideGap({
        is_required: gap.is_required,
        section_status: gap.section_status,
      });
      break;
  }

  return {
    ...gap,
    priority_score: score,
    priority_tier: derivePriorityTier(score),
  };
}
