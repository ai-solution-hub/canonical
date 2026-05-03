/**
 * §5.2 Phase 5 — AC5.3 cross-feature integration test (S216 W6).
 *
 * Spec section 9.5 (line 1622, verbatim):
 *   "After §6.5 wired: superseding item A with item B sets A's
 *    `publication_status='archived'`; A disappears from default search
 *    even with `include_superseded=true` (because admin filter not
 *    passed)"
 *
 * What this test asserts (round-trip):
 *
 *   1. Two content items A + B are seeded with:
 *        - publication_status='published'
 *        - identical embeddings + a unique keyword in content
 *      (so both rows match a default `hybrid_search` query AT BASELINE).
 *
 *   2. `setSupersession({ oldId: A, newId: B, actorUserId })` is invoked
 *      directly via the service-role client (bypasses RLS so the test
 *      doesn't depend on cookie/session plumbing — the helper itself is
 *      what's under test).
 *
 *   3. Post-call invariants on item A:
 *        - superseded_by = B.id  (legacy supersession-model wiring)
 *        - dedup_status = 'superseded'  (legacy)
 *        - publication_status = 'archived'  (NEW — §6.5 + §6.6 trigger)
 *        - archived_at IS NOT NULL  (NEW — direct write OR §6.6 Direction 1)
 *        - archived_by = actorUserId  (NEW — §6.5)
 *        - archive_reason = `Superseded by item ${B.id}`  (NEW default)
 *        - updated_by = actorUserId  (NEW)
 *      Item B unchanged.
 *
 *   4. AC5.3 search behaviour (the load-bearing assertion):
 *        - `hybrid_search()` (default — `include_superseded=false`,
 *          `visibility_filter='default'`) → A absent, B present.
 *        - `hybrid_search(include_superseded=true)` (admin filter NOT
 *          passed) → A still absent, because the §5.2 Phase 3 default
 *          `visibility_filter='default'` excludes archived rows even
 *          when the supersession filter is opened up.
 *        - `hybrid_search(include_superseded=true,
 *           visibility_filter='admin')` → A reappears (sanity check
 *           that the row is still in the DB and the admin filter does
 *           the expected thing — guards against a tautological pass
 *           where A is just deleted).
 *
 * AC5.1, AC5.2, AC5.4 scope decision (per W6 brief):
 *   - AC5.1 (publication-state-search-flow) — covered by W3
 *     `publication-status-rpc-visibility.integration.test.ts` AC2.X
 *     suite. NOT re-tested here.
 *   - AC5.2 (publication-state-archive-flow) — covered by W1
 *     `archive-trigger-coverage.integration.test.ts` (writers 1/2/3 ×
 *     trigger Direction 3). NOT re-tested here.
 *   - AC5.4 (publication-state-dedup) — covered by W1 writer-3 case
 *     (admin-confirm-duplicate writes archived_at; trigger Direction 3
 *     bridges to publication_status='archived'). NOT re-tested here.
 *
 * Spec sources:
 *   - §6.5 lines 1013-1055 — supersession + publication_status='archived'
 *   - §9.5 line 1622 — AC5.3 verbatim
 *   - §10.5 lines 1848-1869 — Phase 5 plan
 *
 * Prereqs:
 *   - `.env.local` with NEXT_PUBLIC_SUPABASE_URL,
 *     SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (for embeddings),
 *     TEST_USER_1_PASSWORD.
 *   - Migration 20260427141627 (Phase 1g §6.6 trigger) applied.
 *   - Migration 20260430192325 (Phase 3 RPC visibility filter widening)
 *     applied — the AC5.3 admin-can-see-archived assertion depends on
 *     `visibility_filter='admin'` being live.
 *
 * Runs via: `bun run test:integration -- publication-state-supersession`
 *   (NOT picked up by `bun run test`; integration runner only — see
 *   feedback_test_runners_split + feedback_integration_test_location.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { setSupersession } from '@/lib/supersession/set';
import { generateEmbedding } from '@/lib/ai/embed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[PUB-STATE-SUPSEDE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const UNIQUE_KEYWORD = `PUBSTATESUPSEDE${Date.now().toString(36)}`;

// ---------------------------------------------------------------------------
// Env-gated skip — mirrors archive-trigger-coverage.integration.test.ts
// pattern. Tests that require both real DB + real OpenAI embedding skip
// gracefully when running against a stripped-down env (CI without
// secrets, local-empty-staging, etc.).
// ---------------------------------------------------------------------------

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY &&
  process.env.TEST_USER_1_PASSWORD,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// State shared across the suite
// ---------------------------------------------------------------------------

const seededIds: string[] = [];
let actorUserId = '';
let itemA = '';
let itemB = '';
let queryEmbedding: number[] | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveAdminUserId(): Promise<string> {
  const adminEmail =
    process.env.TEST_USER_1_EMAIL ?? 'test.user1@test-kb-aish.co.uk';
  const { data: userList, error } = await serviceClient.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    throw new Error(`Could not list users: ${error.message}`);
  }
  const userId = userList.users.find((u) => u.email === adminEmail)?.id;
  if (!userId) {
    throw new Error(
      `Could not resolve admin test user from email "${adminEmail}". ` +
        'Ensure .env.local sets TEST_USER_1_EMAIL or seed the canonical fixture.',
    );
  }
  return userId;
}

interface SeedItemParams {
  label: string;
  embedding: number[];
}

async function seedItem({ label, embedding }: SeedItemParams): Promise<string> {
  // GENERATED ALWAYS column `content_text_hash` MUST be omitted (CLAUDE.md
  // gotcha `feedback_content_text_hash_generated_always`).
  const content =
    `${UNIQUE_KEYWORD} ${TEST_PREFIX} ${label}. ` +
    'Certification audit fixture for publication-state supersession ' +
    'integration testing. Disposable.';
  const { data, error } = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} ${label}`,
      content,
      content_type: 'article',
      publication_status: 'published',
      embedding: JSON.stringify(embedding),
      created_by: actorUserId,
    })
    .select('id, publication_status, archived_at')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }
  if (data.publication_status !== 'published') {
    throw new Error(
      `Seed item "${label}" baseline drift: requested 'published', got ${data.publication_status}`,
    );
  }
  if (data.archived_at !== null) {
    throw new Error(
      `Seed item "${label}" baseline drift: requested archived_at=null, got ${data.archived_at}`,
    );
  }
  seededIds.push(data.id);
  return data.id;
}

interface RowSnapshot {
  id: string;
  publication_status: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archive_reason: string | null;
  superseded_by: string | null;
  dedup_status: string | null;
  updated_by: string | null;
}

async function readRow(itemId: string): Promise<RowSnapshot> {
  // Single-line select string — supabase-js TS schema inference falls back
  // to `GenericStringError` when the column list is split across template
  // concatenations, which silently strips field-level typing.
  const { data, error } = await serviceClient
    .from('content_items')
    .select(
      'id, publication_status, archived_at, archived_by, archive_reason, superseded_by, dedup_status, updated_by',
    )
    .eq('id', itemId)
    .single();
  if (error || !data) {
    throw new Error(
      `readRow(${itemId}) failed: ${error?.message ?? 'no data'}`,
    );
  }
  return data as unknown as RowSnapshot;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
  if (!HAS_REQUIRED_ENV) return;
  actorUserId = await resolveAdminUserId();
  // Single embedding shared across both rows + the search query — this
  // way the items naturally co-occur in the result set at baseline.
  queryEmbedding = await generateEmbedding(
    `${UNIQUE_KEYWORD} certification audit report fixture for integration tests`,
  );
  itemA = await seedItem({
    label: 'A (will be superseded)',
    embedding: queryEmbedding,
  });
  itemB = await seedItem({ label: 'B (successor)', embedding: queryEmbedding });
}, 60_000);

afterAll(async () => {
  if (seededIds.length === 0) return;
  // content_history.content_item_id has FK → content_items.id; clean
  // history first to avoid blocking the parent delete.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);
  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 30_000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC5.3 — supersession archives OLD row + search-visibility cascade',
  () => {
    it('baseline: both A and B appear in default hybrid_search before supersession', async () => {
      expect(itemA).toBeTruthy();
      expect(itemB).toBeTruthy();
      expect(queryEmbedding).toBeTruthy();

      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(queryEmbedding!),
        query_text: UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(itemA);
      expect(ids).toContain(itemB);
    }, 60_000);

    it('setSupersession(A → B) sets archive metadata on A in addition to legacy fields', async () => {
      // Pre-conditions: archived_at IS NULL, publication_status='published'.
      const pre = await readRow(itemA);
      expect(pre.publication_status).toBe('published');
      expect(pre.archived_at).toBeNull();
      expect(pre.superseded_by).toBeNull();

      const beforeMs = Date.now();
      const result = await setSupersession(
        { oldId: itemA, newId: itemB, actorUserId },
        serviceClient,
      );

      // Helper return contract — minimal four-field projection.
      expect(result.oldItem.id).toBe(itemA);
      expect(result.oldItem.superseded_by).toBe(itemB);
      expect(result.oldItem.dedup_status).toBe('superseded');
      expect(result.newItem.id).toBe(itemB);
      expect(result.newItem.superseded_by).toBeNull();

      // §6.5 archive side-effects on the OLD row (read fresh from DB to
      // catch fields not surfaced via the helper return projection).
      const post = await readRow(itemA);
      expect(post.publication_status).toBe('archived');
      expect(post.archived_at).not.toBeNull();
      const archivedTs = new Date(post.archived_at as string).getTime();
      expect(archivedTs).toBeGreaterThanOrEqual(beforeMs - 5_000);
      expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
      expect(post.archived_by).toBe(actorUserId);
      expect(post.archive_reason).toBe(`Superseded by item ${itemB}`);
      expect(post.superseded_by).toBe(itemB);
      expect(post.dedup_status).toBe('superseded');
      expect(post.updated_by).toBe(actorUserId);

      // Item B must remain unchanged — no incidental archive write.
      const newRowState = await readRow(itemB);
      expect(newRowState.publication_status).toBe('published');
      expect(newRowState.archived_at).toBeNull();
      expect(newRowState.superseded_by).toBeNull();
      expect(newRowState.dedup_status).not.toBe('superseded');
    }, 60_000);

    it('AC5.3 — A disappears from default hybrid_search post-supersession', async () => {
      // Default = include_superseded=false + visibility_filter='default'.
      // Both filters now exclude A: the supersession filter (legacy) AND
      // the publication-status filter (Phase 3) — either alone is enough.
      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(queryEmbedding!),
        query_text: UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(itemA);
      expect(ids).toContain(itemB);
    }, 60_000);

    it('AC5.3 — A still excluded with include_superseded=true (admin visibility filter NOT passed)', async () => {
      // The load-bearing assertion: opening the supersession filter
      // alone is NOT sufficient post-§6.5 wiring. The Phase 3 default
      // visibility_filter='default' (= published-only) keeps A invisible
      // because A is now publication_status='archived'. This is the
      // unification described in spec §6.5 lines 1019-1031.
      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(queryEmbedding!),
        query_text: UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
        include_superseded: true,
        // visibility_filter omitted → defaults to 'default' (published-only)
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(itemA);
      expect(ids).toContain(itemB);
    }, 60_000);

    it('AC5.3 sanity — A reappears with include_superseded=true + visibility_filter=admin_all', async () => {
      // Defends against a tautological pass: if A was simply deleted,
      // the prior assertions would also pass. This case proves A is
      // still in the DB and the admin filter widens visibility as
      // expected (Phase 3 RPC widening shipped W3).
      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(queryEmbedding!),
        query_text: UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
        include_superseded: true,
        visibility_filter: 'admin',
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(itemA);
      expect(ids).toContain(itemB);
    }, 60_000);
  },
);
