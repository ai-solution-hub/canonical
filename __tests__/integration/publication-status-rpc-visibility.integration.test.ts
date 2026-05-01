/**
 * §5.2 Phase 3 — RPC visibility filter integration tests (S216 W3).
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md
 *   §5.3 (8-RPC inventory),
 *   §5.3.1 (get_review_breakdown_stats special handling),
 *   §9.2 (AC2.1-AC2.8).
 *
 * Covers:
 *   AC2.1 — hybrid_search default returns ONLY publication_status='published'.
 *   AC2.2 — hybrid_search visibility_filter='all' returns draft + in_review +
 *            published, NOT archived.
 *   AC2.3 — hybrid_search visibility_filter='admin' returns all four states.
 *   AC2.4 — search_for_bid_response same default behaviour.
 *   AC2.5 — search_content_chunks same default behaviour.
 *   AC2.6 — include_superseded=true + visibility_filter='default' returns
 *            published items even if superseded (orthogonal axes coexist).
 *   AC2.7 — Existing 5-arg callers of hybrid_search (post-S186 baseline, no
 *            visibility_filter) get default ('published' only) — backwards-compat.
 *   AC2.8 — Post-Phase-3 get_review_breakdown_stats() returns IDENTICAL numerical
 *            breakdowns to pre-migration (re-baselined post-S204). Snapshot
 *            stored at __tests__/integration/fixtures/review-breakdown-baseline-post-s204.json.
 *
 * Test pattern mirrors __tests__/integration/supersession-filter.integration.test.ts:
 * seed N items via service client, exercise the production RPC contract,
 * tear down. Uses serviceClient (RLS bypass) to isolate from auth-layer
 * concerns — these tests verify the RPC body, not the auth gate.
 *
 * Prereqs:
 *   - .env.local with NEXT_PUBLIC_SUPABASE_URL,
 *     SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, TEST_USER_1_EMAIL.
 *   - Migration `20260430192325_widen_search_rpcs_visibility_filter.sql`
 *     applied on the target DB.
 *
 * Runs via: `bun run test:integration -- publication-status-rpc-visibility`
 *   (NOT picked up by `bun run test`; integration runner only — see
 *   feedback_test_runners_split + feedback_integration_test_location.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serviceClient } from './helpers/service-client';
import { generateEmbedding } from '@/lib/ai/embed';

const TEST_PREFIX = `[PUB-VIS-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}]`;

const UNIQUE_KEYWORD = `PUBVISMARKER${Date.now()}`;

interface SeededItem {
  id: string;
  title: string;
  publication_status: 'draft' | 'in_review' | 'published' | 'archived';
}

const seeded: SeededItem[] = [];
let embedding: number[] | null = null;
let testUserId: string | null = null;
const chunkIds: string[] = [];

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.OPENAI_API_KEY,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

beforeAll(async () => {
  const adminEmail =
    process.env.TEST_USER_1_EMAIL ?? 'test.user1@test-kb-aish.co.uk';
  const { data: userList, error: userErr } =
    await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (userErr) {
    throw new Error(`Could not list users: ${userErr.message}`);
  }
  testUserId = userList.users.find((u) => u.email === adminEmail)?.id ?? null;
  if (!testUserId) {
    throw new Error(
      `Could not resolve admin test user ID from email "${adminEmail}". ` +
        'Ensure TEST_USER_1_EMAIL is set in .env.local and the user exists.',
    );
  }

  // Single embedding shared across all four seed items so they all sit in the
  // same retrieval bucket.
  embedding = await generateEmbedding(
    `${UNIQUE_KEYWORD} content-visibility test fixture for §5.2 Phase 3`,
  );

  const mkContent = (suffix: string) =>
    `${UNIQUE_KEYWORD} ${TEST_PREFIX} ${suffix}. ` +
    'Test fixture for publication-visibility filter integration tests; should ' +
    'never appear in production search results unless tests are running.';

  // Seed one row per publication_status value. content_text_hash is GENERATED
  // ALWAYS so we omit it; explicit publication_status overrides the DEFAULT.
  const states: Array<SeededItem['publication_status']> = [
    'draft',
    'in_review',
    'published',
    'archived',
  ];
  for (const state of states) {
    const insert = await serviceClient
      .from('content_items')
      .insert({
        title: `${TEST_PREFIX} ${state}`,
        content: mkContent(`state=${state}`),
        content_type: 'article',
        embedding: JSON.stringify(embedding),
        created_by: testUserId,
        publication_status: state,
        // archived needs archived_at set (not GENERATED — set explicitly to
        // align with §6.6 invariant).
        ...(state === 'archived'
          ? { archived_at: new Date().toISOString(), archived_by: testUserId }
          : {}),
      })
      .select('id, title, publication_status')
      .single();
    if (insert.error || !insert.data) {
      throw new Error(
        `Seed ${state} failed: ${insert.error?.message ?? 'no data'}`,
      );
    }
    seeded.push(insert.data as SeededItem);
  }

  // Seed one content_chunk per item so AC2.5 has data to query against.
  for (const item of seeded) {
    const chunkInsert = await serviceClient
      .from('content_chunks')
      .insert({
        content_item_id: item.id,
        content: `${UNIQUE_KEYWORD} chunk for ${item.publication_status} state`,
        position: 0,
        char_count: 80,
        word_count: 10,
        embedding: JSON.stringify(embedding),
      })
      .select('id')
      .single();
    if (chunkInsert.error || !chunkInsert.data) {
      throw new Error(
        `Seed chunk for ${item.publication_status} failed: ${chunkInsert.error?.message ?? 'no data'}`,
      );
    }
    chunkIds.push(chunkInsert.data.id as string);
  }
}, 60_000);

afterAll(async () => {
  for (const chunkId of chunkIds) {
    await serviceClient.from('content_chunks').delete().eq('id', chunkId);
  }
  for (const item of seeded) {
    await serviceClient
      .from('content_history')
      .delete()
      .eq('content_item_id', item.id);
    await serviceClient.from('content_items').delete().eq('id', item.id);
  }
});

const seededId = (state: SeededItem['publication_status']): string => {
  const item = seeded.find((s) => s.publication_status === state);
  if (!item) {
    throw new Error(`No seeded item for state ${state}`);
  }
  return item.id;
};

const seededIds = (
  ids: Array<{ id: string }>,
): Set<string> => new Set(ids.map((r) => r.id));

describeIfEnv('§5.2 Phase 3 — hybrid_search visibility_filter', () => {
  it('AC2.1 — default (no param) returns ONLY publication_status=published', async () => {
    expect(embedding).toBeTruthy();
    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
    });
    expect(error).toBeNull();
    const ids = seededIds(data as Array<{ id: string }>);
    expect(ids.has(seededId('published'))).toBe(true);
    expect(ids.has(seededId('draft'))).toBe(false);
    expect(ids.has(seededId('in_review'))).toBe(false);
    expect(ids.has(seededId('archived'))).toBe(false);
  }, 30_000);

  it('AC2.2 — visibility_filter=all returns draft + in_review + published, NOT archived', async () => {
    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
      visibility_filter: 'all',
    });
    expect(error).toBeNull();
    const ids = seededIds(data as Array<{ id: string }>);
    expect(ids.has(seededId('published'))).toBe(true);
    expect(ids.has(seededId('draft'))).toBe(true);
    expect(ids.has(seededId('in_review'))).toBe(true);
    expect(ids.has(seededId('archived'))).toBe(false);
  }, 30_000);

  it('AC2.3 — visibility_filter=admin returns all four states', async () => {
    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
      visibility_filter: 'admin',
    });
    expect(error).toBeNull();
    const ids = seededIds(data as Array<{ id: string }>);
    expect(ids.has(seededId('published'))).toBe(true);
    expect(ids.has(seededId('draft'))).toBe(true);
    expect(ids.has(seededId('in_review'))).toBe(true);
    expect(ids.has(seededId('archived'))).toBe(true);
  }, 30_000);

  it('AC2.7 — pre-§5.2 5-arg callers (no visibility_filter, with include_superseded) get published-only by default', async () => {
    // Mirrors the post-S186 baseline shape — supersession-filter.test.ts uses
    // exactly this argument list. Phase 3 must remain backwards-compatible.
    const { data, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: UNIQUE_KEYWORD,
      similarity_threshold: 0.0,
      limit_count: 100,
      include_superseded: false,
    });
    expect(error).toBeNull();
    const ids = seededIds(data as Array<{ id: string }>);
    expect(ids.has(seededId('published'))).toBe(true);
    expect(ids.has(seededId('draft'))).toBe(false);
    expect(ids.has(seededId('in_review'))).toBe(false);
    expect(ids.has(seededId('archived'))).toBe(false);
  }, 30_000);

  it('AC2.6 — include_superseded=true + visibility_filter=default returns published items even if superseded', async () => {
    // Mark the published row as superseded by another row (use the in_review
    // row as a synthetic successor to avoid creating extra fixtures).
    const publishedId = seededId('published');
    const successorId = seededId('in_review');

    const { error: updateErr } = await serviceClient
      .from('content_items')
      .update({
        superseded_by: successorId,
        dedup_status: 'superseded',
      })
      .eq('id', publishedId);
    expect(updateErr).toBeNull();

    try {
      // include_superseded=false (default-shaped): published-but-superseded
      // row should be HIDDEN.
      const hiddenCall = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(embedding),
        query_text: UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
        include_superseded: false,
        visibility_filter: 'default',
      });
      expect(hiddenCall.error).toBeNull();
      const hiddenIds = seededIds(
        hiddenCall.data as Array<{ id: string }>,
      );
      expect(hiddenIds.has(publishedId)).toBe(false);

      // include_superseded=true + visibility_filter=default: published-but-
      // superseded row reappears (orthogonal axes — supersession opt-in does
      // not require admin-mode visibility).
      const visibleCall = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(embedding),
        query_text: UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
        include_superseded: true,
        visibility_filter: 'default',
      });
      expect(visibleCall.error).toBeNull();
      const visibleIds = seededIds(
        visibleCall.data as Array<{ id: string }>,
      );
      expect(visibleIds.has(publishedId)).toBe(true);
    } finally {
      // Restore the supersession state for downstream tests (the order of
      // describe blocks is important — AC2.8 reads the un-mutated set).
      // dedup_status is NOT NULL with default 'clean'; restore to default.
      await serviceClient
        .from('content_items')
        .update({ superseded_by: null, dedup_status: 'clean' })
        .eq('id', publishedId);
    }
  }, 30_000);
});

describeIfEnv(
  '§5.2 Phase 3 — search_for_bid_response visibility_filter',
  () => {
    it('AC2.4 — default (no param) returns ONLY publication_status=published', async () => {
      const { data, error } = await serviceClient.rpc(
        'search_for_bid_response',
        {
          query_embedding: JSON.stringify(embedding),
          query_text: UNIQUE_KEYWORD,
          limit_count: 100,
        },
      );
      expect(error).toBeNull();
      const ids = seededIds(data as Array<{ id: string }>);
      expect(ids.has(seededId('published'))).toBe(true);
      expect(ids.has(seededId('draft'))).toBe(false);
      expect(ids.has(seededId('in_review'))).toBe(false);
      expect(ids.has(seededId('archived'))).toBe(false);
    }, 30_000);
  },
);

describeIfEnv(
  '§5.2 Phase 3 — search_content_chunks visibility_filter',
  () => {
    it('AC2.5 — default (no param) returns chunks ONLY from publication_status=published items', async () => {
      const { data, error } = await serviceClient.rpc(
        'search_content_chunks',
        {
          query_embedding: JSON.stringify(embedding),
          similarity_threshold: 0.0,
          limit_count: 100,
        },
      );
      expect(error).toBeNull();
      const itemIds = new Set(
        (data as Array<{ content_item_id: string }>).map(
          (r) => r.content_item_id,
        ),
      );
      expect(itemIds.has(seededId('published'))).toBe(true);
      expect(itemIds.has(seededId('draft'))).toBe(false);
      expect(itemIds.has(seededId('in_review'))).toBe(false);
      expect(itemIds.has(seededId('archived'))).toBe(false);
    }, 30_000);
  },
);

describeIfEnv(
  '§5.2 Phase 3 — get_review_breakdown_stats numerical parity (AC2.8)',
  () => {
    it('AC2.8 — post-Phase-3 stats match pre-migration baseline (deep-equal)', async () => {
      const baselinePath = join(
        __dirname,
        'fixtures',
        'review-breakdown-baseline-post-s204.json',
      );
      const baselineFile = JSON.parse(
        readFileSync(baselinePath, 'utf-8'),
      ) as { baseline: Record<string, unknown> };
      const baseline = baselineFile.baseline;

      // Compute the EXPECTED post-migration stats by simulating the new
      // semantics against the pre-migration fixture state. Numerical parity
      // contract per §5.3.1: pre-Phase-3 counted `governance_review_status !=
      // 'draft'` AND `archived_at IS NULL`; post-Phase-3 counts
      // `publication_status = 'published'`. Because the §6.6 trigger
      // guarantees `publication_status='archived' ↔ archived_at IS NOT NULL`,
      // and pre-§5.2 every non-archived row had publication_status='published'
      // by Phase 1c backfill, the count parity holds for the existing corpus.
      //
      // The fixture was captured against a staging branch with one row
      // (publication_status='published'); post-migration the function must
      // return the IDENTICAL JSON.
      //
      // NOTE: this test seeds extra rows in beforeAll (draft, in_review,
      // archived). Those rows are NOT in the baseline. Therefore we run the
      // RPC and assert two invariants:
      //   1. Baseline keys present in post-migration output.
      //   2. The seeded test rows ADD to the counts but do not break parity
      //      on the unmutated data — we subtract our seeded counts and
      //      compare the residual.

      const { data, error } = await serviceClient.rpc(
        'get_review_breakdown_stats',
      );
      expect(error).toBeNull();
      expect(data).toBeTruthy();
      const live = data as {
        total: number;
        verified: number;
        flagged: number;
        draft: number;
        overdue: number;
        by_domain: Record<string, { total: number; verified: number }>;
        by_content_type: Record<string, { total: number; verified: number }>;
        by_source_file: Record<string, unknown>;
        by_source_document: Record<string, unknown>;
      };

      // Subtract our seeded counts. We seeded 1 published + 1 draft +
      // 1 in_review + 1 archived. After Phase 3 semantics:
      //   total: counts publication_status='published' only → +1 from us.
      //   draft: counts publication_status='draft' → +1 from us.
      //   verified: subset of total; our published seed has verified_at=NULL
      //     so verified count delta is 0.
      //   overdue: counts governance_review_status='review_overdue' → 0 delta.
      //   flagged: counts ingestion_quality_log → 0 delta.
      const residualTotal = live.total - 1; // -1 for our seeded published.
      const residualDraft = live.draft - 1; // -1 for our seeded draft.
      const residualVerified = live.verified;
      const residualOverdue = live.overdue;
      const residualFlagged = live.flagged;

      expect(residualTotal).toBe(baseline.total);
      expect(residualDraft).toBe(baseline.draft);
      expect(residualVerified).toBe(baseline.verified);
      expect(residualOverdue).toBe(baseline.overdue);
      expect(residualFlagged).toBe(baseline.flagged);

      // by_content_type: baseline has 'policy'; we added 1 'article' → delta
      // exactly +1 article in published bucket. by_content_type counts
      // publication_status='published' only, so our 1 published 'article'
      // should appear and the existing 'policy' row should be unchanged.
      const articleTotal = live.by_content_type.article?.total ?? 0;
      expect(articleTotal).toBeGreaterThanOrEqual(1);
      const baselinePolicyBucket =
        (baseline.by_content_type as Record<
          string,
          { total: number; verified: number }
        >).policy;
      if (baselinePolicyBucket) {
        const livePolicy = live.by_content_type.policy;
        expect(livePolicy).toBeDefined();
        expect(livePolicy.total).toBe(baselinePolicyBucket.total);
        expect(livePolicy.verified).toBe(baselinePolicyBucket.verified);
      }

      // The shape (top-level keys) must match exactly between baseline and
      // post-migration output — proves we did not accidentally drop or rename
      // a branch.
      const baselineKeys = Object.keys(baseline).sort();
      const liveKeys = Object.keys(live).sort();
      expect(liveKeys).toEqual(baselineKeys);
    }, 30_000);
  },
);
