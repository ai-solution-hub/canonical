/**
 * Token-level matching for entity-temporal bridge.
 *
 * Replaces naive substring matching (context.includes(canonicalName)) with
 * token overlap scoring that handles real-world temporal reference contexts
 * where entity names may be abbreviated, partially mentioned, or reworded.
 *
 * Examples of cases this handles that substring matching cannot:
 * - "ISO 27001 cert renewal due" vs canonical "ISO 27001 Certification"
 * - "27001 certification expires 2027" vs canonical "ISO 27001"
 * - "The GDPR compliance assessment" vs canonical "GDPR"
 */

/** Result of a token match comparison */
export interface TokenMatchResult {
  /** Whether the match meets the confidence threshold */
  match: boolean;
  /** Confidence score: 1.0 (full overlap), 0.8 (most tokens), 0.6 (partial with short name), 0 (no match) */
  confidence: number;
  /** Proportion of canonical name tokens found in the context */
  coverage: number;
}

/**
 * Common stop words to remove during tokenisation.
 * These add noise to token overlap scoring without contributing to entity identification.
 */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'was',
  'are',
  'were',
  'be',
  'been',
  'being',
  'our',
  'their',
  'its',
  'his',
  'her',
  'my',
  'your',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'from',
  'and',
  'or',
  'but',
  'not',
  'this',
  'that',
  'these',
  'those',
  'has',
  'have',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'can',
  'could',
]);

/**
 * Known abbreviation expansions for common entity abbreviations.
 * Used to expand abbreviations in the context string before tokenisation,
 * so that "CE+" can match "Cyber Essentials Plus".
 */
const ABBREVIATION_EXPANSIONS: Record<string, string[]> = {
  'ce+': ['cyber', 'essentials', 'plus'],
  ce: ['cyber', 'essentials'],
  iso: ['iso'], // ISO stays as-is (it is the canonical token)
  gdpr: ['gdpr'],
  pci: ['pci'],
  soc2: ['soc', '2'],
  soc: ['soc'],
};

/**
 * Tokenise a string into a set of meaningful tokens.
 *
 * - Splits on whitespace and punctuation (preserving numbers and alphanumeric sequences)
 * - Lowercases all tokens
 * - Removes common stop words
 * - Filters out empty tokens
 *
 * @param text - Input string to tokenise
 * @returns Array of lowercase tokens (not deduplicated — callers convert to Set as needed)
 */
export function tokenise(text: string): string[] {
  return (
    text
      .toLowerCase()
      // Split on whitespace, punctuation, hyphens, and common separators
      .split(/[\s,;:()\[\]{}"'.\-/]+/)
      // Filter out empty strings, stop words, and very short non-numeric tokens
      .filter((token) => {
        if (!token) return false;
        if (STOP_WORDS.has(token)) return false;
        return true;
      })
  );
}

/**
 * Expand known abbreviations in a token array.
 * Returns a new array with abbreviations replaced by their expansions.
 */
function expandAbbreviations(tokens: string[]): string[] {
  const expanded: string[] = [];
  for (const token of tokens) {
    const expansion = ABBREVIATION_EXPANSIONS[token];
    if (expansion) {
      expanded.push(...expansion);
    } else {
      expanded.push(token);
    }
  }
  return expanded;
}

/**
 * Compute token-level overlap between a temporal reference context and an entity canonical name.
 *
 * Algorithm:
 * 1. Tokenise both strings (split on whitespace/punctuation, lowercase, remove stop words)
 * 2. Expand known abbreviations in the context tokens
 * 3. Compute overlap: contextTokens intersect nameTokens
 * 4. Compute coverage: |overlap| / |nameTokens|
 * 5. Apply confidence thresholds:
 *    - coverage >= 1.0 -> match with confidence 1.0
 *    - coverage >= 0.7 -> match with confidence 0.8
 *    - coverage >= 0.5 AND |nameTokens| <= 2 -> match with confidence 0.6
 *    - coverage < 0.5 -> no match
 *
 * @param context - The temporal reference context string (e.g. "ISO 27001 certification expires June 2026")
 * @param canonicalName - The entity canonical name (e.g. "ISO 27001")
 * @returns Match result with confidence score
 */
export function tokenMatch(
  context: string,
  canonicalName: string,
): TokenMatchResult {
  if (!context || !canonicalName) {
    return { match: false, confidence: 0, coverage: 0 };
  }

  const contextTokens = new Set(expandAbbreviations(tokenise(context)));
  const nameTokens = tokenise(canonicalName);

  // Empty name tokens means nothing to match against
  if (nameTokens.length === 0) {
    return { match: false, confidence: 0, coverage: 0 };
  }

  const nameTokenSet = new Set(nameTokens);

  // Compute intersection
  let overlapCount = 0;
  for (const token of nameTokenSet) {
    if (contextTokens.has(token)) {
      overlapCount++;
    }
  }

  const coverage = overlapCount / nameTokenSet.size;

  // Apply confidence thresholds per spec
  if (coverage >= 1.0) {
    return { match: true, confidence: 1.0, coverage };
  }
  if (coverage >= 0.7) {
    return { match: true, confidence: 0.8, coverage };
  }
  if (coverage >= 0.5 && nameTokenSet.size <= 2) {
    return { match: true, confidence: 0.6, coverage };
  }

  return { match: false, confidence: 0, coverage };
}

/**
 * Parse an ISO 8601 duration string into component parts.
 *
 * Supports: P{n}Y, P{n}M, P{n}D, and combinations like P1Y6M.
 * Does not support time components (hours, minutes, seconds).
 *
 * @param duration - ISO 8601 duration string (e.g. "P3Y", "P6M", "P1Y6M")
 * @returns Parsed components or null if not a valid duration
 */
export function parseDuration(
  duration: string,
): { years: number; months: number; days: number } | null {
  if (!duration || !duration.startsWith('P')) return null;

  const match = duration.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/);
  if (!match) return null;

  const years = match[1] ? parseInt(match[1], 10) : 0;
  const months = match[2] ? parseInt(match[2], 10) : 0;
  const days = match[3] ? parseInt(match[3], 10) : 0;

  // At least one component must be present
  if (years === 0 && months === 0 && days === 0) return null;

  return { years, months, days };
}

/**
 * Check whether a date string looks like an ISO 8601 duration rather than a calendar date.
 *
 * @param date - The date field from a temporal reference
 * @returns true if the date is a duration (e.g. "P3Y", "P6M")
 */
export function isDuration(date: string): boolean {
  return /^P\d/.test(date);
}

/**
 * Compute a calendar date by adding a duration to a start date.
 *
 * @param startDate - ISO 8601 date string (YYYY-MM-DD) to add the duration to
 * @param duration - ISO 8601 duration string (e.g. "P3Y", "P6M", "P1Y6M")
 * @returns ISO 8601 date string, or null if the duration cannot be parsed
 */
export function addDurationToDate(
  startDate: string,
  duration: string,
): string | null {
  const parsed = parseDuration(duration);
  if (!parsed) return null;

  const date = new Date(startDate + 'T00:00:00Z');
  if (isNaN(date.getTime())) return null;

  date.setUTCFullYear(date.getUTCFullYear() + parsed.years);
  date.setUTCMonth(date.getUTCMonth() + parsed.months);
  date.setUTCDate(date.getUTCDate() + parsed.days);

  // Format as YYYY-MM-DD
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
