/**
 * Shared helpers for rendering `relevance_score` values in the UI.
 *
 * The raw score is a 0-1 float (cosine similarity after prompt scoring) and
 * should never appear as a percentage in user-facing copy — see
 * `docs/reference/ai-visibility-policy.md` Rule 2. Both helpers map the score
 * to platform-framed category labels used across the Sector Intelligence
 * workspace surfaces.
 */

export function getRelevanceLabel(score: number | null): string {
  if (score === null) return 'Not sorted';
  if (score >= 0.8) return 'Strong match';
  if (score >= 0.5) return 'Partial match';
  if (score >= 0.2) return 'Weak match';
  return 'Off-topic';
}

export function getRelevanceColourClass(score: number | null): string {
  if (score === null) return '';
  if (score >= 0.8)
    return 'bg-[var(--relevance-high)] text-[var(--relevance-high-text)]';
  if (score >= 0.5)
    return 'bg-[var(--relevance-medium)] text-[var(--relevance-medium-text)]';
  if (score >= 0.2)
    return 'bg-[var(--relevance-low)] text-[var(--relevance-low-text)]';
  return 'bg-[var(--relevance-irrelevant)] text-[var(--relevance-irrelevant-text)]';
}
