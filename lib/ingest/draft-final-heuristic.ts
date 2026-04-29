// lib/ingest/draft-final-heuristic.ts
//
// EP2 §1.11 markdown-batch UI ingest — filename-based draft/final heuristic.
// Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3 §9.1 (filename heuristic).
// Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T2 helpers).
//
// Mirror of the EP8 / Python `should_auto_supersede` filename heuristic. Used
// at both analyse and import phases of the markdown orchestrator. Returns
// 'draft' / 'final' / 'unknown' based on a case-insensitive substring scan
// of the filename. If both 'draft' and 'final' substrings appear, the result
// is 'unknown' (ambiguous — defer to front-matter or per-file override).
//
// Pure function — no side-effects, no Node-only imports. Safe to import from
// either runtime (browser-style or server route handler).

/**
 * Detect a draft/final flag from a filename via case-insensitive substring
 * match. The heuristic looks for the literal substrings 'draft' and 'final'
 * anywhere in the filename (after lowercasing).
 *
 *   - filename contains 'final' but not 'draft' → 'final'
 *   - filename contains 'draft' but not 'final' → 'draft'
 *   - both, or neither                          → 'unknown'
 *
 * Examples:
 *   detectDraftFinalFromFilename('foo-final.md')  // → 'final'
 *   detectDraftFinalFromFilename('foo-draft.md')  // → 'draft'
 *   detectDraftFinalFromFilename('foo.md')        // → 'unknown'
 *   detectDraftFinalFromFilename('FOO-Final.md')  // → 'final' (case-insensitive)
 *   detectDraftFinalFromFilename('draft-final.md')// → 'unknown' (both present)
 */
export function detectDraftFinalFromFilename(
  filename: string,
): 'draft' | 'final' | 'unknown' {
  const lower = filename.toLowerCase();
  const hasDraft = lower.includes('draft');
  const hasFinal = lower.includes('final');
  if (hasFinal && !hasDraft) return 'final';
  if (hasDraft && !hasFinal) return 'draft';
  return 'unknown';
}
