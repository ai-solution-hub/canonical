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
import { tokenMatch, isDuration, addDurationToDate } from '@/lib/entities/token-match';

/** Entity types that can receive temporal metadata */
const TEMPORAL_ENTITY_TYPES = new Set([
  'certification',
  'framework',
  'regulation',
]);

/**
 * Sort temporal references so that 'effective' types come before 'expiry' types.
 * This ensures date_obtained is available when computing duration-based expiry dates.
 * See Appendix C of the pipeline parity spec.
 */
function sortRefsEffectiveFirst<T extends { context_type: string }>(refs: T[]): T[] {
  return [...refs].sort((a, b) => {
    if (a.context_type === 'effective' && b.context_type !== 'effective') return -1;
    if (a.context_type !== 'effective' && b.context_type === 'effective') return 1;
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
    const existingMetadata = (mention.metadata as Record<string, unknown>) ?? {};
    let updated = false;
    const newMetadata = { ...existingMetadata };

    for (const ref of sortedRefs) {
      // Use token-level matching instead of substring includes
      const result = tokenMatch(ref.context, mention.canonical_name);
      if (!result.match) continue;

      if (ref.context_type === 'expiry') {
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
          // If no start date available, skip — cannot compute from duration alone
        } else {
          newMetadata.expiry_date = ref.date;
          updated = true;
        }
      } else if (ref.context_type === 'effective') {
        newMetadata.date_obtained = ref.date;
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
