/**
 * Resolve the full question text for a Q&A content rebuild.
 *
 * Used by the PATCH handler when rebuilding `content_items.content` from
 * `answer_standard` + `answer_advanced` edits. Extracts the question from
 * the existing content's leading `Q: ` line (preserving the full untruncated
 * question), falling back to `title` (which may be truncated at 120 chars).
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss6.2 Option B.
 */

/**
 * Extract the question text from the current content or fall back to the title.
 *
 * Priority:
 * 1. If `currentContent` starts with `Q: `, return the text after the prefix
 *    (first line only, untruncated).
 * 2. Otherwise return `currentTitle` (may be truncated at 120 chars by the
 *    importer's `truncate_at_word_boundary`).
 * 3. If both are null, return an empty string.
 */
export function resolveQuestionForRebuild(
  currentContent: string | null,
  currentTitle: string | null,
): string {
  if (currentContent) {
    const firstLine = currentContent.split('\n', 1)[0];
    if (firstLine.startsWith('Q: ')) {
      return firstLine.slice(3);
    }
  }
  return currentTitle ?? '';
}
