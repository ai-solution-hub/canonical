/**
 * Topic Inference — Suggest topic_id Grouping for New Content Items
 *
 * Server-side function that queries existing items to find topic group
 * matches. Runs after classification (domain/subtopic known) and layer
 * inference (suggested layer known).
 *
 * Two-pass strategy:
 *   Pass 1: Exact domain + subtopic match with existing topic groups
 *   Pass 2: Similarity search for ungrouped items (requires embedding)
 *
 * Spec: docs/specs/layer-suggestion-spec.md (Section 4)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { FALLBACK_LAYERS } from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// Constants
// ---------------------------------------------------------------------------

/** Minimum cosine similarity for Pass 2 to consider items related */
const SIMILARITY_THRESHOLD = 0.75;

/** Maximum similar items to fetch in Pass 2 */
const SIMILARITY_LIMIT = 5;

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
    embeddingArray?: number[];
  },
): Promise<TopicSuggestion | null> {
  const { primaryDomain, primarySubtopic, suggestedLayer, embeddingArray } =
    params;

  // Guard: domain and subtopic are required
  if (!primaryDomain || !primarySubtopic) {
    return null;
  }

  // ---------------------------
  // Pass 1: Exact domain + subtopic match with existing topic groups
  // ---------------------------
  const pass1Result = await findExistingTopicGroup(
    supabase,
    primaryDomain,
    primarySubtopic,
    suggestedLayer,
  );

  if (pass1Result) {
    return pass1Result;
  }

  // ---------------------------
  // Pass 2: Similarity search for ungrouped items
  // ---------------------------
  if (embeddingArray && embeddingArray.length > 0) {
    const pass2Result = await findSimilarUngroupedItem(
      supabase,
      primaryDomain,
      primarySubtopic,
      suggestedLayer,
      embeddingArray,
    );

    if (pass2Result) {
      return pass2Result;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pass 1: Existing topic group lookup
// ---------------------------------------------------------------------------

/**
 * Query items in the same domain/subtopic that already have a topic_id.
 * Group by topic_id and return the best match (most existing layers,
 * preferring groups where the suggested layer is missing).
 */
async function findExistingTopicGroup(
  supabase: SupabaseClient<Database>,
  domain: string,
  subtopic: string,
  suggestedLayer: string,
): Promise<TopicSuggestion | null> {
  const { data: items, error } = await supabase
    .from('content_items')
    .select('id, title, metadata, layer')
    .eq('primary_domain', domain)
    .eq('primary_subtopic', subtopic)
    .not('metadata->topic_id', 'is', null)
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
    const metadata = item.metadata as Record<string, unknown> | null;
    const topicId = metadata?.topic_id as string | undefined;
    const layer = (item as Record<string, unknown>).layer as string | undefined;

    if (!topicId || !layer) continue;

    if (!groups.has(topicId)) {
      groups.set(topicId, []);
    }
    groups.get(topicId)!.push({
      id: item.id,
      title: item.title ?? 'Untitled',
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

// ---------------------------------------------------------------------------
// Pass 2: Similarity search for ungrouped items
// ---------------------------------------------------------------------------

/**
 * If no existing topic groups were found, look for similar items in the
 * same domain/subtopic that lack a topic_id. If found, suggest creating
 * a new topic group linking them.
 */
async function findSimilarUngroupedItem(
  supabase: SupabaseClient<Database>,
  domain: string,
  subtopic: string,
  suggestedLayer: string,
  embedding: number[],
): Promise<TopicSuggestion | null> {
  // Use the find_similar_content RPC to find semantically similar items
  const { data: similarItems, error } = await supabase.rpc(
    'find_similar_content',
    {
      query_embedding: JSON.stringify(embedding),
      similarity_threshold: SIMILARITY_THRESHOLD,
      limit_count: SIMILARITY_LIMIT,
    },
  );

  if (error || !similarItems || similarItems.length === 0) {
    return null;
  }

  // Filter to items in the same domain/subtopic
  // The RPC returns id, title, content, similarity, content_type, platform,
  // author_name, source_domain — but not primary_domain/primary_subtopic.
  // We need to fetch those for the matched items.
  const matchedIds = similarItems.map((item: { id: string }) => item.id);

  const { data: detailItems, error: detailError } = await supabase
    .from('content_items')
    .select('id, title, primary_domain, primary_subtopic, metadata, layer')
    .in('id', matchedIds)
    .is('archived_at', null);

  if (detailError || !detailItems || detailItems.length === 0) {
    return null;
  }

  // Find items in the same domain/subtopic without a topic_id
  // and at a different layer (or no layer)
  const candidates = detailItems.filter((item) => {
    if (item.primary_domain !== domain || item.primary_subtopic !== subtopic) {
      return false;
    }
    const metadata = item.metadata as Record<string, unknown> | null;
    // Skip items that already have a topic_id (Pass 1 would have found them)
    if (metadata?.topic_id) return false;

    // Prefer items at a different layer (or without a layer)
    const itemLayer = (item as Record<string, unknown>).layer as
      | string
      | undefined;
    return !itemLayer || itemLayer !== suggestedLayer;
  });

  if (candidates.length === 0) {
    return null;
  }

  // Pick the first candidate (highest similarity, since RPC returns ordered)
  const bestMatch = candidates[0];
  const matchLayer =
    ((bestMatch as Record<string, unknown>).layer as string) || 'unassigned';

  const topicId = generateTopicId(domain, subtopic);
  const allLayers = getAllLayerKeys();

  // Existing layers: the matched item's layer (if any)
  const existingLayers: Array<{ id: string; title: string; layer: string }> =
    [];
  if (matchLayer !== 'unassigned') {
    existingLayers.push({
      id: bestMatch.id,
      title: bestMatch.title ?? 'Untitled',
      layer: matchLayer,
    });
  }

  const presentLayers = new Set(
    existingLayers.map((l) => l.layer).concat(suggestedLayer),
  );
  const missingLayers = allLayers.filter((l) => !presentLayers.has(l));

  const reason =
    matchLayer !== 'unassigned'
      ? `Similar item "${bestMatch.title}" exists at ${matchLayer} layer — suggest creating new topic group`
      : `Similar item "${bestMatch.title}" found in same domain/subtopic — suggest creating new topic group`;

  return {
    topicId,
    reason,
    existingLayers,
    missingLayers,
  };
}
