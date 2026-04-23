/**
 * Extract the answer portion from a composite Q&A content string.
 *
 * Composite content arrives shaped as "Q: {question}\n\n{answer}". This helper
 * returns only the answer portion, stripping the question prefix. If the content
 * is not in composite form (no "Q: " prefix), it is returned unchanged.
 *
 * Used by Paths 2, 4, and 5 at insert time so that `answer_standard` receives
 * the answer text alone, not the full composite. This prevents double-prefix
 * corruption when the PATCH handler rebuilds content from `answer_standard` +
 * `answer_advanced`.
 *
 * Spec: docs/specs/p0-bm-phase3-qa-library-importer-markdown-spec.md ss4.6.
 */

/**
 * Extract the answer portion from a composite Q&A content string.
 *
 * @param content - The content string, potentially shaped as "Q: {question}\n\n{answer}".
 * @returns The answer portion if composite, or the original content if not.
 */
export function extractAnswerFromContent(
  content: string | null | undefined,
): string {
  if (!content) return '';
  if (content.startsWith('Q: ')) {
    const separatorIndex = content.indexOf('\n\n');
    if (separatorIndex !== -1) {
      return content.slice(separatorIndex + 2);
    }
  }
  return content;
}
