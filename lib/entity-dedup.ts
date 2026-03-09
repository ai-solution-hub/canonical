/**
 * Entity name canonicalisation for deduplication.
 *
 * Shared between the classification pipeline (lib/ai/classify.ts) and
 * batch entity extraction scripts. Import from '@/lib/entity-dedup'.
 */

/**
 * Normalise an entity name for consistent storage and deduplication.
 *
 * Rules applied (in order):
 * 1. Trim whitespace
 * 2. Normalise ISO standards: "ISO27001" -> "ISO 27001"
 * 3. Normalise Cyber Essentials variants
 * 4. Strip trailing periods
 */
export function canonicalise(name: string): string {
  let result = name.trim();
  // Normalise ISO standards: "ISO27001" -> "ISO 27001", always uppercase "ISO"
  result = result.replace(/^iso\s*(\d)/i, 'ISO $1');
  // Strip ISO version suffixes: "ISO 27001:2022" -> "ISO 27001"
  result = result.replace(/^(ISO \d+):\d{4}$/, '$1');
  // Normalise Cyber Essentials variants (including trailing words like "Plus")
  result = result.replace(/^cyber\s*essentials\b/i, 'Cyber Essentials');
  // Strip trailing periods
  result = result.replace(/\.$/, '');
  return result;
}
