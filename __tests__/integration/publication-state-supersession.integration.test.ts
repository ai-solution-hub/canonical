/**
 * §5.2 Phase 5 — AC5.3 cross-feature integration test (S216 W6).
 *
 * Spec section 9.5 (line 1622, verbatim):
 *   "After §6.5 wired: superseding item A with item B sets A's
 *    `publication_status='archived'`; A disappears from default search
 *    even with `include_superseded=true` (because admin filter not
 *    passed)"
 *
 * ID-131.19 M6 retirement note (S450 GO tail, fix-executor amendment):
 * this file originally ALSO exercised `setSupersession()`
 * (lib/supersession/set.ts) directly against a `content_items` fixture
 * (`itemA`/`itemB`) to assert the §6.5 archive-metadata side effects
 * (archived_at/archived_by/archive_reason/dedup_status/updated_by) on
 * supersession. `content_items` was DROPPED at M6 (ID-131.19).
 * `setSupersession()` was SEPARATELY re-pointed onto `q_a_pairs` at
 * ID-131.37 F1 — but q_a_pairs carries ONLY `superseded_by` +
 * `publication_status` (no archived_at/archived_by/archive_reason/
 * dedup_status/updated_by columns at all — see set.ts's own ID-131.37 F1
 * docstring), so the ORIGINAL rich archive-metadata assertions have no
 * destination on ANY current model, not just a not-yet-landed one. That
 * test is RETIRED here with no new-model replacement; a genuinely narrower
 * "setSupersession sets superseded_by + publication_status='archived' on
 * q_a_pairs" test is already covered by the load-bearing search-visibility
 * cascade below (which exercises the identical field pair via a direct
 * `q_a_pairs` update) — see `supersession-row-scoping.integration.test.ts`
 * for the dedicated `setSupersession()`-through-the-helper row-scoping
 * proof (re-seeded onto q_a_pairs in this same Subtask).
 *
 * What survives (ID-131.35 re-seed, unchanged by this retirement): the
 * `AC5.3 search-visibility cascade (q_a_pairs arm)` suite below, seeded onto
 * `q_a_pairs` + `record_embeddings` mirroring
 * `supersession-filter.integration.test.ts`'s idiom. It is the load-bearing
 * coverage for the publication-state × supersession × hybrid_search
 * behaviour described in §6.5 lines 1013-1055 / §9.5 line 1622 above: a
 * direct `q_a_pairs` field update (`superseded_by` + `publication_status:
 * 'archived'`) mirrors the production §6.5 semantics on the row under test,
 * and the four tests assert the same search-visibility cascade the spec
 * describes (default hides the archived row even with
 * `include_superseded=true`; `visibility_filter='admin'` proves the row is
 * still present, guarding against a tautological pass).
 *
 * AC5.1, AC5.2, AC5.4 scope decision (per original W6 brief, still true):
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
 *     SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (for embeddings).
 *   - hybrid_search (ID-131.11 M5, migration
 *     20260702120000_id131_search_rpcs.sql) — 4-arm polymorphic UNION over
 *     record_embeddings (source_documents / content_chunks / q_a_pairs /
 *     reference_items), NO content_items scan.
 *
 * Runs via: `bun run test:integration -- publication-state-supersession`
 *   (NOT picked up by `bun run test`; integration runner only — see
 *   feedback_test_runners_split + feedback_integration_test_location.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { generateEmbedding } from '@/lib/ai/embed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[PUB-STATE-SUPSEDE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;

// ID-131.35 — the q_a_pairs (hybrid_search arm) fixture.
const QA_UNIQUE_KEYWORD = `PUBSTATEQA${Date.now().toString(36)}`;
// Must match hybrid_search's `embedding_model` DECLARE constant — record_embeddings
// rows under any other model string are invisible to the vector JOIN.
const EMBEDDING_MODEL = 'text-embedding-3-large';

// ---------------------------------------------------------------------------
// Env-gated skip — mirrors archive-trigger-coverage.integration.test.ts
// pattern. Tests that require both real DB + real OpenAI embedding skip
// gracefully when running against a stripped-down env (CI without
// secrets, local-empty-staging, etc.).
// ---------------------------------------------------------------------------

const HAS_REQUIRED_ENV = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.OPENAI_API_KEY,
);
const describeIfEnv = HAS_REQUIRED_ENV ? describe : describe.skip;

// ---------------------------------------------------------------------------
// State shared across the suite
// ---------------------------------------------------------------------------

// ID-131.35 — q_a_pairs (hybrid_search arm) fixture state.
let qaItemA = '';
let qaItemB = '';
let qaQueryEmbedding: number[] | null = null;

// ID-131.35 Checker-FAIL remediation — ids captured here immediately after
// each q_a_pairs insert succeeds inside seedQaPair (mirrors the `.push`
// idiom in supersession-filter.integration.test.ts), so a downstream
// record_embeddings insert failure (e.g. the {131.19}-deferred
// api.record_embeddings view, PGRST205) can no longer orphan the parent
// row: afterAll below cleans up from this array, not from
// `[qaItemA, qaItemB]` (only assigned once seedQaPair fully returns — i.e.
// never, on that failure path).
const qaSeededIds: string[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ID-131.35 — seeds a q_a_pair (+ record_embeddings vector row) for the
// hybrid_search-arm tests. Mirrors supersession-filter.integration.test.ts's
// seeding idiom.
async function seedQaPair(label: string, embedding: number[]): Promise<string> {
  const { data, error } = await serviceClient
    .from('q_a_pairs')
    .insert({
      question_text: `${QA_UNIQUE_KEYWORD} ${TEST_PREFIX} ${label} certification audit question`,
      answer_standard:
        `${QA_UNIQUE_KEYWORD} ${TEST_PREFIX} ${label}. ` +
        'Certification audit report fixture for publication-state supersession integration testing.',
      publication_status: 'published',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed q_a_pair "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }

  // Capture immediately — before attempting the record_embeddings insert,
  // which can throw. Cleanup must not depend on this function's return
  // value succeeding (Checker FAIL — see qaSeededIds docstring above).
  qaSeededIds.push(data.id);

  const { error: embeddingError } = await serviceClient
    .from('record_embeddings')
    .insert({
      owner_kind: 'q_a_pair',
      owner_id: data.id,
      model: EMBEDDING_MODEL,
      embedding: JSON.stringify(embedding),
    });
  if (embeddingError) {
    throw new Error(
      `Seed record_embeddings for "${label}" failed: ${embeddingError.message}`,
    );
  }

  return data.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIfEnv(
  'AC5.3 — supersession archives OLD row + search-visibility cascade (q_a_pairs arm)',
  () => {
    beforeAll(async () => {
      qaQueryEmbedding = await generateEmbedding(
        `${QA_UNIQUE_KEYWORD} certification audit report fixture for integration tests`,
      );
      qaItemA = await seedQaPair('A (will be superseded)', qaQueryEmbedding);
      qaItemB = await seedQaPair('B (successor)', qaQueryEmbedding);
    }, 60_000);

    afterAll(async () => {
      // ID-131.35 Checker-FAIL remediation — clean up from qaSeededIds
      // (populated inside seedQaPair immediately after each q_a_pairs
      // insert succeeds), NOT from `[qaItemA, qaItemB]`: those module vars
      // are only assigned once seedQaPair fully returns, so a
      // record_embeddings insert failure mid-seed would previously leave
      // this array-based guard empty and orphan the q_a_pairs row.
      if (qaSeededIds.length === 0) return;
      // record_embeddings carries no FK to q_a_pairs (polymorphic owner) —
      // delete explicitly.
      await serviceClient
        .from('record_embeddings')
        .delete()
        .eq('owner_kind', 'q_a_pair')
        .in('owner_id', qaSeededIds);
      await serviceClient.from('q_a_pairs').delete().in('id', qaSeededIds);
    }, 30_000);

    it('baseline: both A and B appear in default hybrid_search before supersession', async () => {
      expect(qaItemA).toBeTruthy();
      expect(qaItemB).toBeTruthy();
      expect(qaQueryEmbedding).toBeTruthy();

      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(qaQueryEmbedding!),
        query_text: QA_UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(qaItemA);
      expect(ids).toContain(qaItemB);
    }, 60_000);

    it('AC5.3 — A disappears from default hybrid_search post-supersession', async () => {
      // ID-131.35: direct q_a_pairs field update — NOT setSupersession()
      // (see module docstring for why the setSupersession()-through-the-
      // helper coverage now lives in
      // supersession-row-scoping.integration.test.ts instead). Mirrors the
      // production §6.5 semantics (superseded_by + publication_status
      // archived) directly on the row under test, matching
      // supersession-filter.integration.test.ts's idiom.
      const { error: updateErr } = await serviceClient
        .from('q_a_pairs')
        .update({ superseded_by: qaItemB, publication_status: 'archived' })
        .eq('id', qaItemA);
      expect(updateErr).toBeNull();

      // Default = include_superseded=false + visibility_filter='default'.
      // Both filters now exclude A: the supersession filter (legacy) AND
      // the publication-status filter (Phase 3) — either alone is enough.
      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(qaQueryEmbedding!),
        query_text: QA_UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(qaItemA);
      expect(ids).toContain(qaItemB);
    }, 60_000);

    it('AC5.3 — A still excluded with include_superseded=true (admin visibility filter NOT passed)', async () => {
      // The load-bearing assertion: opening the supersession filter
      // alone is NOT sufficient post-§6.5 wiring. The Phase 3 default
      // visibility_filter='default' (= published-only) keeps A invisible
      // because A is now publication_status='archived'. This is the
      // unification described in spec §6.5 lines 1019-1031.
      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(qaQueryEmbedding!),
        query_text: QA_UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
        include_superseded: true,
        // visibility_filter omitted → defaults to 'default' (published-only)
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(qaItemA);
      expect(ids).toContain(qaItemB);
    }, 60_000);

    it('AC5.3 sanity — A reappears with include_superseded=true + visibility_filter=admin_all', async () => {
      // Defends against a tautological pass: if A was simply deleted,
      // the prior assertions would also pass. This case proves A is
      // still in the DB and the admin filter widens visibility as
      // expected (Phase 3 RPC widening shipped W3).
      const { data, error } = await serviceClient.rpc('hybrid_search', {
        query_embedding: JSON.stringify(qaQueryEmbedding!),
        query_text: QA_UNIQUE_KEYWORD,
        similarity_threshold: 0.0,
        limit_count: 100,
        include_superseded: true,
        visibility_filter: 'admin',
      });

      expect(error).toBeNull();
      const ids = (data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(qaItemA);
      expect(ids).toContain(qaItemB);
    }, 60_000);
  },
);
