/**
 * Supersession filter — real DB integration test (S186 WP-B.3).
 *
 * Seeds two q_a_pairs (+ their record_embeddings vector rows), marks one as
 * superseded by the other, and verifies the `include_superseded` param on
 * `hybrid_search` and `search_for_form_response` defaults to false (hides
 * superseded rows) and can be opted into.
 *
 * ID-131 {131.16} G-FORMS re-seed: both RPCs were re-pointed off the retiring
 * content_items god-table onto the typed record tables. q_a_pairs is the
 * PRIMARY match arm of search_for_form_response (migration
 * 20260703150000_id131_form_response_rpc.sql) and Arm 3 of hybrid_search
 * (20260702120000_id131_search_rpcs.sql); vector reads come from
 * record_embeddings (owner_kind='q_a_pair'), not an inline column, so seeding
 * writes both tables. The reference_items arm shares the identical
 * `include_superseded OR superseded_by IS NULL` gate — the q_a_pairs primary
 * arm carries the supersession assertions here.
 *
 * Spec: docs/specs/supersession-model-spec.md §4.1–§4.3
 * Plan: docs/plans/supersession-model-plan.md §B.3 acceptance
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { generateEmbedding } from '@/lib/ai/embed';

const TEST_PREFIX = `[SUPERSEDE-${Date.now()}]`;

// Must match the RPCs' `embedding_model` DECLARE constant — record_embeddings
// rows under any other model string are invisible to the vector JOIN.
const EMBEDDING_MODEL = 'text-embedding-3-large';

interface TestPair {
  id: string;
}

let oldPair: TestPair | null = null;
let newPair: TestPair | null = null;
let embedding: number[] | null = null;

const UNIQUE_KEYWORD = 'SUPERSEDEMARKER'; // Very unlikely to collide with real data

async function seedPair(suffix: string): Promise<TestPair> {
  const insert = await serviceClient
    .from('q_a_pairs')
    .insert({
      question_text: `${UNIQUE_KEYWORD} ${TEST_PREFIX} certification audit question (${suffix})`,
      answer_standard:
        `${UNIQUE_KEYWORD} ${TEST_PREFIX} ${suffix}. ` +
        'Certification audit report covering ISO 27001, Cyber Essentials, ' +
        'and data protection obligations for the integration test suite.',
      // Both RPCs' 'default' visibility gates on publication_status='published'.
      publication_status: 'published',
    })
    .select('id')
    .single();

  if (insert.error || !insert.data) {
    throw new Error(
      `Seed q_a_pair (${suffix}) failed: ${insert.error?.message ?? 'no data'}`,
    );
  }

  // Vector arm reads record_embeddings, not an inline column (BI-17 EMB-STORE).
  const embeddingInsert = await serviceClient.from('record_embeddings').insert({
    owner_kind: 'q_a_pair',
    owner_id: insert.data.id,
    model: EMBEDDING_MODEL,
    embedding: JSON.stringify(embedding),
  });

  if (embeddingInsert.error) {
    throw new Error(
      `Seed record_embeddings (${suffix}) failed: ${embeddingInsert.error.message}`,
    );
  }

  return insert.data;
}

beforeAll(async () => {
  // Share one embedding across both pairs so they hit the same retrieval set
  embedding = await generateEmbedding(
    `${UNIQUE_KEYWORD} certification audit report for integration tests`,
  );

  oldPair = await seedPair('old revision');
  newPair = await seedPair('new revision');
}, 30_000);

afterAll(async () => {
  const ids = [oldPair?.id, newPair?.id].filter((v): v is string => Boolean(v));
  if (ids.length > 0) {
    // record_embeddings carries no FK to q_a_pairs (polymorphic owner) —
    // delete explicitly; q_a_pair_history cascades on the q_a_pairs delete.
    await serviceClient
      .from('record_embeddings')
      .delete()
      .eq('owner_kind', 'q_a_pair')
      .in('owner_id', ids);
    await serviceClient.from('q_a_pairs').delete().in('id', ids);
  }
});

describe('Supersession filter — hybrid_search', () => {
  it('default call includes the old row BEFORE supersession', async () => {
    expect(oldPair && newPair && embedding).toBeTruthy();

    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
    });

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(oldPair!.id);
    expect(ids).toContain(newPair!.id);
  }, 60_000);

  it('default call hides the old row AFTER supersession (include_superseded=false implicit)', async () => {
    const { error: updateErr } = await serviceClient
      .from('q_a_pairs')
      .update({ superseded_by: newPair!.id })
      .eq('id', oldPair!.id);
    expect(updateErr).toBeNull();

    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
    });

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(oldPair!.id);
    expect(ids).toContain(newPair!.id);
  }, 30_000);

  it('include_superseded=true surfaces the superseded row again', async () => {
    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
      include_superseded: true,
    });

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(oldPair!.id);
    expect(ids).toContain(newPair!.id);
  }, 30_000);
});

describe('Supersession filter — search_for_form_response', () => {
  it('default call hides the superseded row', async () => {
    const { data, error } = await serviceClient.rpc(
      'search_for_form_response',
      {
        query_embedding: JSON.stringify(embedding),
        query_text: UNIQUE_KEYWORD,
        limit_count: 100,
      },
    );

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(oldPair!.id);
    // new row appears (above threshold)
    expect(ids).toContain(newPair!.id);
  }, 30_000);

  it('include_superseded=true surfaces the superseded row again', async () => {
    const { data, error } = await serviceClient.rpc(
      'search_for_form_response',
      {
        query_embedding: JSON.stringify(embedding),
        query_text: UNIQUE_KEYWORD,
        limit_count: 100,
        include_superseded: true,
      },
    );

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(oldPair!.id);
    expect(ids).toContain(newPair!.id);
  }, 30_000);
});
