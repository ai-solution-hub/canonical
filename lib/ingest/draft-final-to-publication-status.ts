// lib/ingest/draft-final-to-publication-status.ts
//
// EP2 §1.11 markdown-batch UI ingest — draft/final → publication_status mapper.
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 §9.2 (D-A baked in).
// Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T2 helpers).
//
// Maps the 3-valued draft/final flag (filename heuristic, front-matter override,
// or per-file UI override) onto the canonical `content_items.publication_status`
// column. Decision-A (D-A) is baked in: a 'final' file lands in 'in_review',
// NOT 'published' — admin approval is still required.
//
// Pure function — no side-effects, no Node-only imports. Safe to import from
// either runtime (browser-style or server route handler).

/**
 * Map a draft/final flag to the canonical `publication_status` value
 * (spec §9.2 Table — D-A baked in).
 *
 *   'draft'   → 'draft'
 *   'final'   → 'in_review'  (NOT 'published' — admin approval required)
 *   'unknown' → 'draft'      (conservative)
 */
export function draftFinalToPublicationStatus(
  draftOrFinal: 'draft' | 'final' | 'unknown',
): 'draft' | 'in_review' {
  if (draftOrFinal === 'final') return 'in_review';
  return 'draft';
}
