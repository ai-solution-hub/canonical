/**
 * WP-CI.RES.7 §4.4 — Deterministic entity_mentions + entity_relationships.
 *
 * Creates 15 entity_mentions distributed across fixture content items,
 * using real entity types from the entity_aliases reference table.
 * Creates 5 entity_relationships linking mentions.
 *
 * Spec: wp-ci-res7-staging-data-strategy-spec.md §4.4.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

function deterministicUuid(index: number): string {
  const hex = createHash('sha256')
    .update(`entity-fixture-${index}`)
    .digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** Fallback entity types if entity_aliases is sparsely populated. */
const FALLBACK_ENTITY_TYPES = [
  'organisation',
  'person',
  'technology',
  'regulation',
  'standard',
];

interface EntityFixtureResult {
  entityMentionIds: string[];
  entityRelationshipIds: string[];
}

/**
 * Seed 15 entity_mentions + 5 entity_relationships.
 *
 * @param contentItemIds - IDs of fixture content_items to attach mentions to.
 *   Must have at least 5 items.
 */
export async function seedEntityFixtures(
  client: SupabaseClient<Database>,
  contentItemIds: string[],
): Promise<EntityFixtureResult> {
  if (contentItemIds.length < 5) {
    throw new Error(
      `Entity fixtures: need >= 5 content_items, got ${contentItemIds.length}`,
    );
  }

  // Fetch entity_aliases for realistic entity types.
  // S246 WP2b T2 (P5): column `category` renamed to `provenance`.
  const { data: aliases } = await client
    .from('entity_aliases')
    .select('canonical, provenance')
    .limit(20);

  const entityTypes =
    aliases && aliases.length >= 5
      ? [...new Set(aliases.map((a) => a.provenance))].slice(0, 5)
      : FALLBACK_ENTITY_TYPES;

  const canonicalNames =
    aliases && aliases.length >= 5
      ? aliases.map((a) => a.canonical).slice(0, 15)
      : Array.from({ length: 15 }, (_, i) => `Fixture Entity ${i}`);

  // ── Build entity_mentions ─────────────────────────────────────────────

  type MentionInsert =
    Database['public']['Tables']['entity_mentions']['Insert'];
  const mentions: MentionInsert[] = [];

  for (let i = 0; i < 15; i++) {
    const itemId = contentItemIds[i % contentItemIds.length]!;
    const entityType = entityTypes[i % entityTypes.length]!;
    const canonical = canonicalNames[i % canonicalNames.length]!;

    mentions.push({
      id: deterministicUuid(i),
      source_document_id: itemId,
      entity_name: canonical,
      canonical_name: canonical,
      entity_type: entityType,
      confidence: 0.85 + (i % 3) * 0.05,
      context_snippet: `Fixture mention of ${canonical} in content item context.`,
    });
  }

  const { data: insertedMentions, error: mentionErr } = await client
    .from('entity_mentions')
    .insert(mentions)
    .select('id');

  if (mentionErr) {
    throw new Error(
      `Entity fixtures: entity_mentions insert failed — ${mentionErr.message}`,
    );
  }

  const entityMentionIds = (insertedMentions ?? []).map((r) => r.id);

  // ── Build entity_relationships ────────────────────────────────────────

  type RelInsert =
    Database['public']['Tables']['entity_relationships']['Insert'];
  const relationships: RelInsert[] = [];

  const relationshipTypes = [
    'works_with',
    'regulates',
    'supplies_to',
    'competes_with',
    'subsidiary_of',
  ];

  for (let i = 0; i < 5; i++) {
    const source = canonicalNames[i]!;
    const target = canonicalNames[(i + 1) % canonicalNames.length]!;

    relationships.push({
      id: deterministicUuid(200 + i),
      source_entity: source,
      target_entity: target,
      relationship_type: relationshipTypes[i]!,
      source_document_id: contentItemIds[i % contentItemIds.length],
      confidence: 0.75,
    });
  }

  const { data: insertedRels, error: relErr } = await client
    .from('entity_relationships')
    .insert(relationships)
    .select('id');

  if (relErr) {
    throw new Error(
      `Entity fixtures: entity_relationships insert failed — ${relErr.message}`,
    );
  }

  const entityRelationshipIds = (insertedRels ?? []).map((r) => r.id);

  console.log(
    `[fixtures] Seeded ${entityMentionIds.length} entity_mentions + ${entityRelationshipIds.length} entity_relationships`,
  );

  return { entityMentionIds, entityRelationshipIds };
}
