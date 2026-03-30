/**
 * Temporal reference reconciliation.
 *
 * Merges AI-classified temporal references (from Claude) with regex-extracted
 * temporal references (from lib/date-extraction.ts), deduplicating by date
 * and preferring AI classification when they disagree on context_type.
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
 * Merge AI and regex temporal reference paths, deduplicating by date + context_type.
 * When both paths detect the same date, AI classification takes precedence.
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
        // Same date+context_type already from AI — mark as 'both'
        const existing = merged.get(key)!;
        existing.source = 'both';
      } else {
        // Check if same date exists with different context_type from AI
        // In that case, AI's context_type takes precedence — skip this regex ref
        const aiHasSameDate = Array.from(merged.values()).some(
          (m) => m.date === ref.date && (m.source === 'ai' || m.source === 'both'),
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
