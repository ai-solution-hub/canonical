/**
 * WP-CI.RES.7 §4.4 — Deterministic content_items + content_chunks fixtures.
 *
 * Creates 27 content_items (20 published + 5 archived + 2 draft) with
 * correct publication_status and valid FK references to refreshed taxonomy.
 * Each item gets one content_chunk (27 total).
 *
 * Spec: wp-ci-res7-staging-data-strategy-spec.md §4.4.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

/** Pipeline service account UUID per CLAUDE.md. */
const PIPELINE_USER_ID = 'a0000000-0000-4000-8000-000000000001';

/** Prefix for all fixture titles — enables bulk cleanup queries. */
export const FIXTURE_PREFIX = 'fixture-ci-res7';

/**
 * Deterministic UUID generator per spec §4.4:
 * crypto.createHash('sha256').update('fixture-' + index).digest('hex')
 * formatted as UUID v4.
 */
function deterministicUuid(index: number): string {
  const hex = createHash('sha256').update(`fixture-${index}`).digest('hex');
  // Format as UUID v4: set version nibble (4) and variant bits (8/9/a/b).
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Synthetic 1024-dimensional embedding vector per spec §4.4:
 * All zeros except dimension `index % 1024 = 1.0`.
 */
function syntheticEmbedding(index: number): string {
  const vec = new Array<number>(1024).fill(0);
  vec[index % 1024] = 1.0;
  return JSON.stringify(vec);
}

interface ContentFixtureResult {
  contentItemIds: string[];
  contentChunkIds: string[];
}

/**
 * Seed 27 content_items + 27 content_chunks into the staging DB.
 *
 * The caller is responsible for calling `cleanupContentFixtures()` to
 * remove fixture data after tests complete.
 */
export async function seedContentFixtures(
  client: SupabaseClient<Database>,
): Promise<ContentFixtureResult> {
  // Fetch reference data for FK assignment.
  const { data: domains, error: domErr } = await client
    .from('taxonomy_domains')
    .select('id, name')
    .order('name')
    .limit(5);
  if (domErr || !domains || domains.length < 5) {
    throw new Error(
      `Content fixtures: need >= 5 taxonomy_domains, got ${domains?.length ?? 0}: ${domErr?.message ?? ''}`,
    );
  }

  const { data: subtopics, error: subErr } = await client
    .from('taxonomy_subtopics')
    .select('id, domain_id')
    .limit(50);
  if (subErr || !subtopics || subtopics.length < 10) {
    throw new Error(
      `Content fixtures: need >= 10 taxonomy_subtopics, got ${subtopics?.length ?? 0}: ${subErr?.message ?? ''}`,
    );
  }

  // Build domain→subtopic map for FK-valid assignments.
  const domainSubtopics = new Map<string, string[]>();
  for (const st of subtopics) {
    const existing = domainSubtopics.get(st.domain_id) ?? [];
    existing.push(st.id);
    domainSubtopics.set(st.domain_id, existing);
  }

  // ── Build content_items rows ──────────────────────────────────────────

  type ContentInsert = Database['public']['Tables']['content_items']['Insert'];
  const items: ContentInsert[] = [];

  // 20 published items distributed across 5 domains.
  for (let i = 0; i < 20; i++) {
    const domain = domains[i % 5]!;
    const domSubs = domainSubtopics.get(domain.id) ?? [];
    const subtopicId = domSubs.length > 0 ? domSubs[i % domSubs.length] : null;

    items.push({
      id: deterministicUuid(i),
      title: `${FIXTURE_PREFIX}-published-${i}`,
      content: `Integration fixture content for published item ${i}. Domain: ${domain.name}. This deterministic content exercises the same code paths as production-shaped data.`,
      content_type: 'article',
      publication_status: 'published',
      primary_domain: domain.id,
      primary_subtopic: subtopicId ?? undefined,
      created_by: PIPELINE_USER_ID,
      governance_review_status: 'approved',
    });
  }

  // 5 archived items.
  for (let i = 20; i < 25; i++) {
    const domain = domains[i % 5]!;
    items.push({
      id: deterministicUuid(i),
      title: `${FIXTURE_PREFIX}-archived-${i - 20}`,
      content: `Integration fixture content for archived item ${i - 20}. Archived for trigger coverage tests.`,
      content_type: 'article',
      publication_status: 'archived',
      primary_domain: domain.id,
      created_by: PIPELINE_USER_ID,
      archived_at: new Date().toISOString(),
      archived_by: PIPELINE_USER_ID,
      archive_reason: 'CI fixture — archived for integration test coverage',
    });
  }

  // 2 draft items.
  for (let i = 25; i < 27; i++) {
    const domain = domains[i % 5]!;
    items.push({
      id: deterministicUuid(i),
      title: `${FIXTURE_PREFIX}-draft-${i - 25}`,
      content: `Integration fixture content for draft item ${i - 25}. Governance review pending.`,
      content_type: 'article',
      publication_status: 'draft',
      primary_domain: domain.id,
      created_by: PIPELINE_USER_ID,
      governance_review_status: 'draft',
    });
  }

  // ── Insert content_items ──────────────────────────────────────────────

  const { data: insertedItems, error: insertErr } = await client
    .from('content_items')
    .insert(items)
    .select('id');

  if (insertErr) {
    throw new Error(
      `Content fixtures: content_items insert failed — ${insertErr.message}`,
    );
  }

  const contentItemIds = (insertedItems ?? []).map((r) => r.id);

  // ── Build + insert content_chunks ─────────────────────────────────────

  type ChunkInsert = Database['public']['Tables']['content_chunks']['Insert'];
  const chunks: ChunkInsert[] = contentItemIds.map((itemId, i) => ({
    id: deterministicUuid(100 + i),
    source_document_id: itemId,
    content: `Chunk content for fixture item ${i}. This is the primary text chunk.`,
    position: 0,
    word_count: 12,
    char_count: 70,
    embedding: syntheticEmbedding(i),
  }));

  const { data: insertedChunks, error: chunkErr } = await client
    .from('content_chunks')
    .insert(chunks)
    .select('id');

  if (chunkErr) {
    throw new Error(
      `Content fixtures: content_chunks insert failed — ${chunkErr.message}`,
    );
  }

  const contentChunkIds = (insertedChunks ?? []).map((r) => r.id);

  console.log(
    `[fixtures] Seeded ${contentItemIds.length} content_items + ${contentChunkIds.length} content_chunks`,
  );

  return { contentItemIds, contentChunkIds };
}

/**
 * Clean up all fixture data. Deletes in FK-safe order:
 * content_chunks → content_history → entity_mentions →
 * entity_relationships → content_items.
 */
export async function cleanupContentFixtures(
  client: SupabaseClient<Database>,
  contentItemIds: string[],
): Promise<void> {
  if (contentItemIds.length === 0) return;

  // FK-safe deletion order — children before parents.
  await client
    .from('content_chunks')
    .delete()
    .in('source_document_id', contentItemIds);
  await client
    .from('content_history')
    .delete()
    .in('content_item_id', contentItemIds);
  await client
    .from('entity_mentions')
    .delete()
    .in('source_document_id', contentItemIds);
  await client
    .from('entity_relationships')
    .delete()
    .in('source_item_id', contentItemIds);
  await client.from('content_items').delete().in('id', contentItemIds);

  console.log(`[fixtures] Cleaned up ${contentItemIds.length} fixture items`);
}
