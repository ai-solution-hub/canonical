/**
 * Topic Inference — Suggest topic_id Grouping for New Content Items
 *
 * Server-side function that queries existing items to find topic group
 * matches. Runs after classification (domain/subtopic known) and layer
 * inference (suggested layer known).
 *
 * Strategy: exact domain + subtopic match with existing topic groups
 * (formerly "Pass 1" of a two-pass strategy). The former "Pass 2"
 * (similarity search for ungrouped items via the find_similar_content RPC)
 * was removed under ID-131.15 (G-DEDUP retirement) — that RPC was part of
 * the legacy content_items dedup family DROPped in that Subtask. See
 * `findSimilarUngroupedItem` removal note in git history for detail.
 *
 * Spec: docs/specs/layer-suggestion-spec.md (Section 4)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { FALLBACK_LAYERS } from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** @public */
export interface TopicSuggestion {
  /** Suggested topic_id string */
  topicId: string;
  /** Human-readable reason */
  reason: string;
  /** Existing items in this topic group */
  existingLayers: Array<{
    id: string;
    title: string;
    layer: string;
  }>;
  /** Layers that are missing from this topic group */
  missingLayers: string[];
}

// ---------------------------------------------------------------------------
// Topic ID generation
// ---------------------------------------------------------------------------

/**
 * Generate a topic_id slug from domain and subtopic strings.
 *
 * Convention from `docs/specs/2026-03-12-topic-id-population.md`:
 *   - Lowercase, hyphen-separated
 *   - Domain prefix for namespacing
 *   - e.g. "Compliance" + "KCSIE" => "compliance-kcsie"
 */
export function generateTopicId(domain: string, subtopic: string): string {
  return `${domain}-${subtopic}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// ---------------------------------------------------------------------------
// All layer keys helper
// ---------------------------------------------------------------------------

/** Returns all known layer keys from the static vocabulary */
function getAllLayerKeys(): string[] {
  return FALLBACK_LAYERS.map((l) => l.key);
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Suggest a topic_id for a new content item by finding existing items
 * that could form a topic group.
 *
 * @param supabase - Authenticated Supabase client
 * @param params   - Classification and layer inference results
 * @returns TopicSuggestion if a match is found, null otherwise
 */
export async function suggestTopic(
  supabase: SupabaseClient<Database>,
  params: {
    primaryDomain: string;
    primarySubtopic: string;
    title: string;
    suggestedLayer: string;
    /**
     * Retained for caller compatibility (4 call sites still pass this from
     * their embedding-generation step). Unused since ID-131.15 removed the
     * similarity-search pass that consumed it (it called the since-dropped
     * find_similar_content RPC).
     */
    embeddingArray?: number[];
  },
): Promise<TopicSuggestion | null> {
  const { primaryDomain, primarySubtopic, suggestedLayer } = params;

  // Guard: domain and subtopic are required
  if (!primaryDomain || !primarySubtopic) {
    return null;
  }

  // ---------------------------
  // Exact domain + subtopic match with existing topic groups
  // ---------------------------
  const result = await findExistingTopicGroup(
    supabase,
    primaryDomain,
    primarySubtopic,
    suggestedLayer,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Pass 1: Existing topic group lookup
// ---------------------------------------------------------------------------

/**
 * Query items in the same domain/subtopic that already have a topic_id.
 * Group by topic_id and return the best match (most existing layers,
 * preferring groups where the suggested layer is missing).
 *
 * ID-131 {131.17} G-IMS-DELETE KEEP-list: re-pointed off content_items onto
 * source_documents (M3 gave SD the classification family). `title` has no SD
 * column of the same name — original_filename/filename is the nearest
 * analog; `metadata` -> `extraction_metadata`. `layer` has NO source_documents
 * analog — D5 (TECH.md §"Trigger functions") ratified that `layer` DIES with
 * content_items and is deliberately NOT re-homed (the sibling Guides Task
 * owns the separate `layer_vocabulary` audience-axis system). Every group is
 * therefore built with an empty layer set, so this function now always
 * returns `null` (no topic-group match) — a graceful, contract-preserving
 * degradation callers already handle as the normal "no suggestion" case.
 * Flagged for the orchestrator/Curator: this feature's premise (layer-
 * coverage grouping) no longer has a data source; a follow-up may want to
 * retire `suggestTopic` outright rather than carry the now-permanently-null
 * path.
 */
async function findExistingTopicGroup(
  supabase: SupabaseClient<Database>,
  domain: string,
  subtopic: string,
  suggestedLayer: string,
): Promise<TopicSuggestion | null> {
  const { data: items, error } = await supabase
    .from('source_documents')
    .select('id, original_filename, filename, extraction_metadata')
    .eq('primary_domain', domain)
    .eq('primary_subtopic', subtopic)
    .not('extraction_metadata->topic_id', 'is', null)
    .is('archived_at', null);

  if (error || !items || items.length === 0) {
    return null;
  }

  // Group items by topic_id
  const groups = new Map<
    string,
    Array<{ id: string; title: string; layer: string }>
  >();

  for (const item of items) {
    const metadata = item.extraction_metadata as Record<string, unknown> | null;
    const topicId = metadata?.topic_id as string | undefined;
    // `layer` has no source_documents column (D5) — always absent, so no
    // item is ever added to a group below (see the function doc comment).
    const layer: string | null = null;

    if (!topicId || !layer) continue;

    if (!groups.has(topicId)) {
      groups.set(topicId, []);
    }
    groups.get(topicId)!.push({
      id: item.id,
      title: item.original_filename ?? item.filename ?? 'Untitled',
      layer,
    });
  }

  if (groups.size === 0) {
    return null;
  }

  // Score each group: prefer groups where the suggested layer is missing
  // and that have the most existing layers
  const allLayers = getAllLayerKeys();
  let bestGroup: {
    topicId: string;
    items: Array<{ id: string; title: string; layer: string }>;
    missingLayers: string[];
    suggestedLayerMissing: boolean;
  } | null = null;

  for (const [topicId, groupItems] of groups) {
    const presentLayers = new Set(groupItems.map((i) => i.layer));
    const missingLayers = allLayers.filter((l) => !presentLayers.has(l));
    const suggestedLayerMissing = !presentLayers.has(suggestedLayer);

    // Skip if all layers are present — no gap to fill
    if (missingLayers.length === 0) continue;

    const isBetter =
      !bestGroup ||
      // Prefer groups where the suggested layer is missing
      (suggestedLayerMissing && !bestGroup.suggestedLayerMissing) ||
      // Among equal priority, prefer groups with more existing layers
      (suggestedLayerMissing === bestGroup.suggestedLayerMissing &&
        groupItems.length > bestGroup.items.length);

    if (isBetter) {
      bestGroup = {
        topicId,
        items: groupItems,
        missingLayers,
        suggestedLayerMissing,
      };
    }
  }

  if (!bestGroup) {
    return null;
  }

  const presentLayerNames = bestGroup.items
    .map((i) => i.layer)
    .filter((v, i, a) => a.indexOf(v) === i) // unique
    .join(', ');

  const reason = bestGroup.suggestedLayerMissing
    ? `Existing topic group "${bestGroup.topicId}" has ${presentLayerNames} but is missing ${suggestedLayer}`
    : `Existing topic group "${bestGroup.topicId}" covers this domain and subtopic`;

  return {
    topicId: bestGroup.topicId,
    reason,
    existingLayers: bestGroup.items,
    missingLayers: bestGroup.missingLayers,
  };
}
