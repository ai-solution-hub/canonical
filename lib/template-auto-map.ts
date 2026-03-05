/**
 * Text similarity functions for auto-mapping template fields to bid questions.
 *
 * Uses normalised word overlap (Dice coefficient) -- a deterministic,
 * programmatic approach that requires no AI or embedding lookup.
 */

/**
 * Normalise text for comparison: lowercase, remove punctuation, collapse whitespace.
 */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate similarity between two strings using normalised word overlap (Dice coefficient).
 *
 * Returns a score between 0.0 (no overlap) and 1.0 (identical word sets).
 */
export function similarity(a: string, b: string): number {
  const normA = normaliseText(a);
  const normB = normaliseText(b);
  if (!normA || !normB) return 0;

  const wordsA = normA.split(' ');
  const wordsB = normB.split(' ');
  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = new Set([...setA].filter((w) => setB.has(w)));

  return (2 * intersection.size) / (setA.size + setB.size);
}
