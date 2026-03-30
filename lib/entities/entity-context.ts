/**
 * Entity context snippet extraction.
 *
 * Extracts a short text excerpt showing where an entity was mentioned
 * in the source content. Used during classification to populate the
 * `context_snippet` column on entity_mentions.
 */

/**
 * Find the entity name in the text and return surrounding context (±80 chars).
 *
 * Returns the first occurrence with ellipsis markers where the snippet
 * was truncated (i.e. not at the start or end of the text).
 *
 * @param text       The full plain text to search in
 * @param entityName The entity name to locate (case-insensitive)
 * @returns A context snippet string, or null if the entity is not found
 */
export function extractEntityContext(
  text: string,
  entityName: string,
): string | null {
  if (!text || !entityName) return null;

  const lowerText = text.toLowerCase();
  const lowerEntity = entityName.toLowerCase();
  const idx = lowerText.indexOf(lowerEntity);

  if (idx === -1) return null;

  const contextRadius = 80;
  const start = Math.max(0, idx - contextRadius);
  const end = Math.min(text.length, idx + entityName.length + contextRadius);

  let snippet = text.slice(start, end).trim();

  // Add ellipsis markers where text was truncated
  if (start > 0) {
    snippet = `...${snippet}`;
  }
  if (end < text.length) {
    snippet = `${snippet}...`;
  }

  return snippet;
}
