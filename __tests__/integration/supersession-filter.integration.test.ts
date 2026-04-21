/**
 * Supersession filter — real DB integration test (S186 WP-B.3).
 *
 * Seeds two content items, marks one as superseded by the other, and
 * verifies the `include_superseded` param on `hybrid_search` and
 * `search_for_bid_response` defaults to false (hides superseded rows)
 * and can be opted into.
 *
 * Spec: docs/specs/supersession-model-spec.md §4.1–§4.3
 * Plan: docs/plans/supersession-model-plan.md §B.3 acceptance
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, OPENAI_API_KEY
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { generateEmbedding } from '@/lib/ai/embed';

const TEST_PREFIX = `[SUPERSEDE-${Date.now()}]`;

interface TestItem {
  id: string;
  title: string;
  content: string;
}

let oldItem: TestItem | null = null;
let newItem: TestItem | null = null;
let embedding: number[] | null = null;
let testUserId: string | null = null;

const UNIQUE_KEYWORD = 'SUPERSEDEMARKER'; // Very unlikely to collide with real data

beforeAll(async () => {
  // Resolve the admin test user by email (avoids joining the 13-file
  // hardcoded-UUID backlog WP-C is triaging). Uses the auth admin API so
  // the lookup is schema-independent.
  const adminEmail =
    process.env.TEST_USER_1_EMAIL ?? 'test.user1@test-kb-aish.co.uk';

  const { data: userList, error: userErr } =
    await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (userErr) {
    throw new Error(`Could not list users: ${userErr.message}`);
  }

  testUserId =
    userList.users.find((u) => u.email === adminEmail)?.id ?? null;

  if (!testUserId) {
    throw new Error(
      `Could not resolve admin test user ID from email "${adminEmail}". ` +
        'Ensure TEST_USER_1_EMAIL is set in .env and the user exists.',
    );
  }

  // Share one embedding across both items so they hit the same retrieval set
  embedding = await generateEmbedding(
    `${UNIQUE_KEYWORD} certification audit report for integration tests`,
  );

  const mkContent = (suffix: string) =>
    `${UNIQUE_KEYWORD} ${TEST_PREFIX} ${suffix}. ` +
    'Certification audit report covering ISO 27001, Cyber Essentials, ' +
    'and data protection obligations for the integration test suite.';

  const oldInsert = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} OLD (v1)`,
      content: mkContent('old revision'),
      content_type: 'article',
      embedding: JSON.stringify(embedding),
      created_by: testUserId,
    })
    .select('id, title, content')
    .single();

  if (oldInsert.error || !oldInsert.data) {
    throw new Error(
      `Seed old item failed: ${oldInsert.error?.message ?? 'no data'}`,
    );
  }
  oldItem = oldInsert.data;

  const newInsert = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} NEW (v2)`,
      content: mkContent('new revision'),
      content_type: 'article',
      embedding: JSON.stringify(embedding),
      created_by: testUserId,
    })
    .select('id, title, content')
    .single();

  if (newInsert.error || !newInsert.data) {
    throw new Error(
      `Seed new item failed: ${newInsert.error?.message ?? 'no data'}`,
    );
  }
  newItem = newInsert.data;
}, 30_000);

afterAll(async () => {
  if (oldItem?.id) {
    await serviceClient
      .from('content_history')
      .delete()
      .eq('content_item_id', oldItem.id);
    await serviceClient.from('content_items').delete().eq('id', oldItem.id);
  }
  if (newItem?.id) {
    await serviceClient
      .from('content_history')
      .delete()
      .eq('content_item_id', newItem.id);
    await serviceClient.from('content_items').delete().eq('id', newItem.id);
  }
});

describe('Supersession filter — hybrid_search', () => {
  it('default call includes the old row BEFORE supersession', async () => {
    expect(oldItem && newItem && embedding).toBeTruthy();

    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
    });

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(oldItem!.id);
    expect(ids).toContain(newItem!.id);
  }, 60_000);

  it('default call hides the old row AFTER supersession (include_superseded=false implicit)', async () => {
    const { error: updateErr } = await serviceClient
      .from('content_items')
      .update({
        superseded_by: newItem!.id,
        dedup_status: 'superseded',
      })
      .eq('id', oldItem!.id);
    expect(updateErr).toBeNull();

    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
    });

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(oldItem!.id);
    expect(ids).toContain(newItem!.id);
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
    expect(ids).toContain(oldItem!.id);
    expect(ids).toContain(newItem!.id);
  }, 30_000);
});

describe('Supersession filter — search_for_bid_response', () => {
  it('default call hides the superseded row', async () => {
    const { data, error } = await serviceClient.rpc(
      'search_for_bid_response',
      {
        query_embedding: JSON.stringify(embedding),
        query_text: UNIQUE_KEYWORD,
        limit_count: 100,
      },
    );

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(oldItem!.id);
    // new row appears (above threshold)
    expect(ids).toContain(newItem!.id);
  }, 30_000);

  it('include_superseded=true surfaces the superseded row again', async () => {
    const { data, error } = await serviceClient.rpc(
      'search_for_bid_response',
      {
        query_embedding: JSON.stringify(embedding),
        query_text: UNIQUE_KEYWORD,
        limit_count: 100,
        include_superseded: true,
      },
    );

    expect(error).toBeNull();
    const ids = (data as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(oldItem!.id);
    expect(ids).toContain(newItem!.id);
  }, 30_000);
});
