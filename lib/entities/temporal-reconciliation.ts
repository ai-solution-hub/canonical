/**
 * Temporal reference reconciliation.
 *
 * Merges AI-classified temporal references (from Claude) with regex-extracted
 * temporal references (from lib/date-extraction.ts), deduplicating by date
 * (with fuzzy within-30-day matching for same year-month) and preferring AI
 * classification when they disagree on context_type.
 */

import type { ClassificationTemporalReference } from '@/lib/ai/classify';
import type { TemporalReference } from '@/lib/date-extraction';

/** Unified temporal reference after merging both extraction paths. */
export interface MergedTemporalReference {
  /** ISO 8601 date string (YYYY-MM-DD) */
  date: string;
  /** What this date refers to */
  context: string;
  /** Classified context type */
  context_type: 'expiry' | 'effective' | 'historical' | 'unknown';
  /** Which extraction source produced this reference */
  source: 'ai' | 'regex' | 'both';
}

/**
 * Check whether two ISO 8601 date strings (YYYY-MM-DD) are within the same
 * calendar month (i.e. share the YYYY-MM prefix). This enables fuzzy dedup
 * when AI returns "2027-03-25" and regex returns "2027-03-01" for the same
 * reference — they should be treated as duplicates.
 */
function isSameYearMonth(dateA: string, dateB: string): boolean {
  return dateA.slice(0, 7) === dateB.slice(0, 7);
}

/**
 * Merge AI and regex temporal reference paths, deduplicating by date + context_type.
 * When both paths detect the same date (or a date within the same calendar month),
 * AI classification takes precedence.
 *
 * @param aiRefs    Temporal references from Claude classification
 * @param regexRefs Temporal references from regex date extraction
 * @returns Deduplicated, merged array of temporal references
 */
export function reconcileTemporalReferences(
  aiRefs: ClassificationTemporalReference[] | undefined,
  regexRefs: TemporalReference[] | undefined,
): MergedTemporalReference[] {
  const merged = new Map<string, MergedTemporalReference>();

  // AI references first — they take precedence on conflicts
  if (aiRefs?.length) {
    for (const ref of aiRefs) {
      const key = `${ref.date}|${ref.context_type}`;
      merged.set(key, {
        date: ref.date,
        context: ref.context,
        context_type: ref.context_type,
        source: 'ai',
      });
    }
  }

  // Regex references — only add if the same date+context_type combo doesn't exist
  if (regexRefs?.length) {
    for (const ref of regexRefs) {
      // Map regex 'type' field to our 'context_type' naming
      const contextType = ref.type as 'expiry' | 'effective' | 'historical' | 'unknown';
      const key = `${ref.date}|${contextType}`;

      if (merged.has(key)) {
        // Exact date+context_type match from AI — mark as 'both'
        const existing = merged.get(key)!;
        existing.source = 'both';
      } else {
        // Fuzzy match: check if AI has a date within the same calendar month
        // and same context_type. AI is more precise, so its date wins.
        const fuzzyMatch = Array.from(merged.values()).find(
          (m) =>
            isSameYearMonth(m.date, ref.date) &&
            m.context_type === contextType &&
            (m.source === 'ai' || m.source === 'both'),
        );

        if (fuzzyMatch) {
          // Same month + same context_type — treat as duplicate, mark as 'both'
          fuzzyMatch.source = 'both';
          continue;
        }

        // Check if same date (exact or fuzzy) exists with different context_type from AI
        // In that case, AI's context_type takes precedence — skip this regex ref
        const aiHasSameDate = Array.from(merged.values()).some(
          (m) =>
            (m.date === ref.date || isSameYearMonth(m.date, ref.date)) &&
            (m.source === 'ai' || m.source === 'both'),
        );

        if (aiHasSameDate) {
          // AI already classified this date differently — skip regex version
          continue;
        }

        merged.set(key, {
          date: ref.date,
          context: ref.context,
          context_type: contextType,
          source: 'regex',
        });
      }
    }
  }

  return Array.from(merged.values());
}
