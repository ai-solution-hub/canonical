/**
 * Entity metadata bridge — connects temporal references to entity mentions.
 *
 * After classifyContent() populates both entity_mentions and temporal
 * references (in content_items.metadata), this bridge function matches
 * expiry/effective dates to the relevant certification/framework/regulation
 * entities and writes the dates into entity_mentions.metadata.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { ClassificationTemporalReference } from '@/lib/ai/classify';
import type { TemporalReference } from '@/lib/date-extraction';
import { reconcileTemporalReferences } from '@/lib/entities/temporal-reconciliation';

/** Entity types that can receive temporal metadata */
const TEMPORAL_ENTITY_TYPES = new Set([
  'certification',
  'framework',
  'regulation',
]);

/**
 * Bridge certification temporal references to entity mention metadata.
 * Called after classifyContent() to populate entity_mentions.metadata
 * with expiry dates from temporal references in the same content item.
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

  // 2. Read entity mentions for this content item (certification/framework/regulation only)
  const { data: mentions, error: mentionError } = await supabase
    .from('entity_mentions')
    .select('id, canonical_name, entity_type, metadata')
    .eq('content_item_id', contentItemId)
    .in('entity_type', Array.from(TEMPORAL_ENTITY_TYPES));

  if (mentionError || !mentions?.length) return;

  // 3. Match temporal references to entity mentions by context string
  for (const mention of mentions) {
    const canonicalLower = mention.canonical_name.toLowerCase();
    const existingMetadata = (mention.metadata as Record<string, unknown>) ?? {};
    let updated = false;
    const newMetadata = { ...existingMetadata };

    for (const ref of mergedRefs) {
      const contextLower = ref.context.toLowerCase();

      // Check if the temporal reference context mentions this entity
      if (!contextLower.includes(canonicalLower)) continue;

      if (ref.context_type === 'expiry') {
        newMetadata.expiry_date = ref.date;
        updated = true;
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
