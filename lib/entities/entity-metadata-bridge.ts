/**
 * Entity metadata bridge — connects temporal references to entity mentions.
 *
 * After classifyContent() populates both entity_mentions and temporal
 * references (in content_items.metadata), this bridge function matches
 * expiry/effective dates to the relevant certification/framework/regulation
 * entities and writes the dates into entity_mentions.metadata.
 *
 * Uses token-level matching (Phase 4) instead of naive substring matching
 * for better precision with abbreviated or partial entity names in context
 * strings. Also supports duration-to-date computation for ISO 8601 duration
 * values (e.g. "P3Y" = 3 years from date obtained).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { ClassificationTemporalReference } from '@/lib/ai/classify';
import type { TemporalReference } from '@/lib/date-extraction';
import { reconcileTemporalReferences } from '@/lib/entities/temporal-reconciliation';
import {
  tokenMatch,
  isDuration,
  addDurationToDate,
} from '@/lib/entities/token-match';

/** Entity types that can receive temporal metadata */
const TEMPORAL_ENTITY_TYPES = new Set([
  'certification',
  'framework',
  'regulation',
]);

/** Keywords suggesting a temporal reference describes an expiry or renewal date */
const EXPIRY_KEYWORDS = [
  'expires',
  'expiry',
  'renewal',
  'valid for',
  'due',
  'valid until',
  'renew',
  'lapse',
  'expire',
];

/** Keywords suggesting a temporal reference describes an effective or obtained date */
const EFFECTIVE_KEYWORDS = [
  'effective',
  'came into force',
  'achieved',
  'awarded',
  'obtained',
  'certified',
  'introduced',
  'implemented',
  'enacted',
  'commenced',
];

/**
 * Infer context type from keywords in the temporal reference context string.
 *
 * Scans for expiry-related and effective-related keywords to determine the
 * likely meaning of an "unknown" or "historical" context_type reference.
 *
 * @param context - The temporal reference context string
 * @returns Inferred context type, or null if neither direction is clear
 */
export function inferContextType(
  context: string,
): 'expiry' | 'effective' | null {
  if (!context) return null;
  const lower = context.toLowerCase();

  const hasExpiry = EXPIRY_KEYWORDS.some((kw) => lower.includes(kw));
  const hasEffective = EFFECTIVE_KEYWORDS.some((kw) => lower.includes(kw));

  // If both match or neither matches, we cannot infer
  if (hasExpiry && !hasEffective) return 'expiry';
  if (hasEffective && !hasExpiry) return 'effective';
  return null;
}

/**
 * Sort temporal references so that 'effective' types come before 'expiry' types.
 * This ensures date_obtained is available when computing duration-based expiry dates.
 * See Appendix C of the pipeline parity spec.
 */
function sortRefsEffectiveFirst<T extends { context_type: string }>(
  refs: T[],
): T[] {
  return [...refs].sort((a, b) => {
    if (a.context_type === 'effective' && b.context_type !== 'effective')
      return -1;
    if (a.context_type !== 'effective' && b.context_type === 'effective')
      return 1;
    return 0;
  });
}

/**
 * Bridge certification temporal references to entity mention metadata.
 * Called after classifyContent() to populate entity_mentions.metadata
 * with expiry dates from temporal references in the same content item.
 *
 * Uses token-level matching to compare temporal reference context strings
 * against entity canonical names. Also computes calendar dates from ISO 8601
 * duration values when a start date (date_obtained) is available.
 *
 * @param supabase      Authenticated Supabase client
 * @param contentItemId The content item to process
 */
export async function bridgeTemporalReferencesToEntities(
  supabase: SupabaseClient<Database>,
  contentItemId: string,
): Promise<void> {
  // 1. Read content item metadata for temporal references
  const { data: item, error: itemError } = await supabase
    .from('content_items')
    .select('metadata')
    .eq('id', contentItemId)
    .single();

  if (itemError || !item?.metadata) return;

  const metadata = item.metadata as Record<string, unknown>;
  const aiRefs = metadata.ai_temporal_references as
    | ClassificationTemporalReference[]
    | undefined;
  const regexRefs = metadata.temporal_references as
    | TemporalReference[]
    | undefined;

  // No temporal references to bridge
  if (!aiRefs?.length && !regexRefs?.length) return;

  // Reconcile both paths
  const mergedRefs = reconcileTemporalReferences(aiRefs, regexRefs);
  if (!mergedRefs.length) return;

  // Sort so effective dates are processed before expiry (needed for duration computation)
  const sortedRefs = sortRefsEffectiveFirst(mergedRefs);

  // 2. Read entity mentions for this content item (certification/framework/regulation only)
  const { data: mentions, error: mentionError } = await supabase
    .from('entity_mentions')
    .select('id, canonical_name, entity_type, metadata')
    .eq('content_item_id', contentItemId)
    .in('entity_type', Array.from(TEMPORAL_ENTITY_TYPES));

  if (mentionError || !mentions?.length) return;

  // 3. Match temporal references to entity mentions using token-level matching
  for (const mention of mentions) {
    const existingMetadata =
      (mention.metadata as Record<string, unknown>) ?? {};
    let updated = false;
    const newMetadata = { ...existingMetadata };

    for (const ref of sortedRefs) {
      let matched = false;

      // When the classifier has performed co-extraction, related_entity is
      // the authoritative link from the temporal reference to its entity.
      // Trust it exclusively — do not fall back to tokenMatch, because
      // tokenMatch can produce false positives across same-family entities
      // (e.g. "ISO 27001" context tokens overlap with "ISO 9001" canonical
      // via the shared "iso" token, causing 0.5 coverage / 0.6 confidence
      // hits on any 2-token name). The co-extraction spec intent (see
      // Part A architecture diagram) is that tokenMatch is only a
      // *backwards-compat fallback for refs without related_entity*.
      if (ref.related_entity) {
        const relatedNormalised = ref.related_entity.toLowerCase();
        if (relatedNormalised === mention.canonical_name.toLowerCase()) {
          matched = true;
        }
        // related_entity is set but names don't match: skip this ref for
        // this mention. Do not fall through to tokenMatch.
      } else {
        // Legacy path: no related_entity on this ref (pre-co-extraction
        // data, regex-only refs, or AI failed to link). Token-level
        // matching against the context string is the only option.
        const result = tokenMatch(ref.context, mention.canonical_name);
        if (result.match) {
          matched = true;
        }
      }

      if (!matched) continue;

      // Determine the effective context type — use the declared type when
      // it is explicit, otherwise attempt keyword inference for ambiguous refs.
      let effectiveType: string = ref.context_type;
      if (
        ref.context_type === 'unknown' ||
        ref.context_type === 'historical'
      ) {
        const inferred = inferContextType(ref.context);
        if (inferred) {
          effectiveType = inferred;
        }
      }

      if (effectiveType === 'expiry') {
        // Check if the date is a duration (e.g. "P3Y") that needs computation
        if (isDuration(ref.date)) {
          const startDate = (newMetadata.date_obtained as string) ?? null;
          if (startDate) {
            const computedDate = addDurationToDate(startDate, ref.date);
            if (computedDate) {
              newMetadata.expiry_date = computedDate;
              updated = true;
            }
          }
          // If no start date available but we know it's expiry-related,
          // store the duration as renewal_period for downstream use
          if (!updated || !newMetadata.expiry_date) {
            newMetadata.renewal_period = ref.date;
            updated = true;
          }
        } else {
          newMetadata.expiry_date = ref.date;
          updated = true;
        }
      } else if (effectiveType === 'effective') {
        newMetadata.date_obtained = ref.date;
        updated = true;
      } else if (isDuration(ref.date)) {
        // Matched entity with a duration value but context type is still
        // ambiguous after keyword inference — store as renewal_period.
        // Duration values like P1Y describe certification/regulation lifecycle
        // periods and are valuable metadata even without expiry/effective context.
        newMetadata.renewal_period = ref.date;
        updated = true;
      }
    }

    // 4. Update entity mention metadata if we found matching references
    if (updated) {
      await supabase
        .from('entity_mentions')
        .update({ metadata: newMetadata as Record<string, string> })
        .eq('id', mention.id);
    }
  }
}
