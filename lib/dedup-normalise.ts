/**
 * Title-normalisation for cross-source duplicate detection (S183 WP2).
 *
 * Used by the dedup gate when we need to detect near-identical titles
 * that differ only in articles, casing, or trailing punctuation.
 * Motivating example: "Are access levels granted according to the
 * principle of least privilege?" vs "...according to principle of
 * least privilege?" collided on import but content_text_hash missed
 * them because the answer bodies differed slightly.
 *
 * Mirror of `scripts/dedup_normalise.py` — keep the algorithms in sync.
 */

// Word-boundary articles — matches "the", "a", "an" as standalone words
// so "according to the principle" and "according to principle" collapse
// to the same form. Reference S183 acceptance in the continuation prompt
// ("Are access levels granted according to [the] principle..." should
// dedup with the "the"-less variant).
const STANDALONE_ARTICLES = /\b(?:the|a|an)\b/gi;
const TRAILING_PUNCTUATION = /[?.!,;:\s]+$/;
const INTERNAL_WHITESPACE = /\s+/g;

/**
 * Normalise a title for dedup comparison.
 *
 * Steps:
 *   1. Lowercase
 *   2. Remove standalone articles ("the", "a", "an") anywhere in the text
 *   3. Collapse whitespace to single spaces
 *   4. Strip trailing punctuation (?, ., !, ,, ;, :) and whitespace
 *
 * Trade-off: removing mid-sentence articles accepts a small false-positive
 * risk (e.g. "going to a shop" vs "going to shop") for the benefit of
 * catching the S182-surfaced regression pair. The alternative — leading
 * articles only — fails to catch cross-file Q&A title variants that were
 * the original motivation for this helper.
 *
 * Returns an empty string if the input is empty or only punctuation.
 */
export function normaliseTitleForDedup(title: string): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(STANDALONE_ARTICLES, ' ')
    .replace(INTERNAL_WHITESPACE, ' ')
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
}
