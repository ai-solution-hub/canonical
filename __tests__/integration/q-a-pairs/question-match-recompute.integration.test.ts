/**
 * ID-57 {57.6} T10 WP2 — Integration tests for the question_match_recompute
 * writer RPC (live scoring + population writer).
 *
 * Scope: specs/id-57-question-matches-retrieval/{PRODUCT,TECH}.md §E (writer).
 * Reads are through the `question_match_search` reader RPC — see the ID-57.7
 * fix note below for why (question_matches is INTERNAL_ONLY_TABLES; no api
 * view exists by policy).
 * Exercises:
 *   1. recompute materialises ranked candidate rows into question_matches with
 *      BOTH per-method scores + the caller-supplied question_kind, and
 *      RETURNS the materialised row count (PRODUCT E1/E2; A5).
 *   2. corpus eligibility filters (PRODUCT B5/B6): non-overlapping scope,
 *      anti-scope overlap, non-'published', and NULL question_embedding pairs
 *      are excluded from the materialised candidate set.
 *   3. idempotent re-compute: a second recompute call leaves NO duplicate edge
 *      (the A6 UNIQUE (form_question_id, q_a_pair_id) holds) and the stored
 *      score reflects the LATEST scoring, not a stale value (PRODUCT E2/E3;
 *      ON CONFLICT upsert).
 *   4. stored score fidelity (PRODUCT D1/D2/D3): embedding_score ≈
 *      1.0 - cosine_distance; fulltext_score = ts_rank(.,2), and a query with
 *      no lexical overlap yields a stored fulltext_score of 0 (not null).
 *   5. ID-57.9 regression: an anti-parallel query embedding (cosine_distance
 *      2) no longer violates question_matches_embedding_score_range_chk —
 *      the recompute succeeds and the stored embedding_score clamps to 0.
 *
 * Sources of truth:
 *   * specs/id-57-question-matches-retrieval/TECH.md §E (writer DDL + scoring)
 *   * specs/id-57-question-matches-retrieval/PRODUCT.md §E (E1/E2/E3),
 *     §B (B5 scope/anti-scope, B6 eligibility), §D (D1/D2/D3 scoring)
 *   * Migration 20260613191008_id57_question_matches_table.sql (table shape +
 *     A6 UNIQUE + score range CHECKs)
 *   * Migration 20260615165758_id57_question_match_rpcs.sql (writer RPC)
 *   * Migration 20260709234230_id57_clamp_question_match_embedding_score.sql
 *     (ID-57.9 embedding_score clamp — author-only, not yet applied)
 *
 * CLAUDE.md gotchas applied:
 *   * Embedding vector: JSON.stringify(embeddingArray) for RPC vector params,
 *     NOT a raw array.
 *   * Service-role client: bypasses RLS for test setup/teardown.
 *   * FK-safe cleanup order: q_a_pairs → form_questions → workspaces;
 *     question_matches CASCADE-deletes from both parents (no explicit delete
 *     needed — see the ID-57.7 fix note below).
 *   * Hard assertions only — no conditional if-visible patterns.
 *   * KH_RUN_INTEGRATION guard: describe.skipIf so non-integration runs skip.
 *   * .select() on mutating queries prevents the HTTP 204 sandbox hang.
 *
 * NOTE (deferred apply): the combined writer+reader migration is applied to
 * staging ONCE at {57.7}. This suite is authored here but RUN at {57.7} after
 * that apply. Until then it remains green-by-skip (KH_RUN_INTEGRATION unset).
 *
 * Run via:
 *   KH_RUN_INTEGRATION=1 bun run test:integration -- __tests__/integration/q-a-pairs/
 *
 * ID-131.19 M6-adjacent retirement (drop_inline_vector_cols,
 * 20260706120000_id131_drop_inline_vector_cols.sql): `q_a_pairs.question_embedding`
 * DROPPED — vector storage moved to the polymorphic `record_embeddings` table
 * (owner_kind='q_a_pair', owner_id, model). `seedQaPair`'s `embedding` option now
 * writes record_embeddings directly instead of the inline column.
 *
 * FIXED (ID-131.19, S450 GO tail #3): the `question_match_recompute` SQL
 * function — THE subject of this whole suite — used to read
 * `qap.question_embedding` directly in its body (the cosine-distance
 * expression AND the B6 `WHERE qap.question_embedding IS NOT NULL`
 * eligibility filter; squash baseline, never redefined by the {131.11}
 * search redesign), which errored ("column does not exist") once the column
 * was dropped. Re-pointed to JOIN record_embeddings (owner_kind='q_a_pair')
 * by supabase/migrations/20260706170000_id131_qa_fns_record_embeddings_repoint.sql
 * — AUTHORED, NOT YET APPLIED (owner-gated GO-sequence apply); this suite
 * passes once that migration lands on the live DB. Separate from
 * lib/q-a-pairs/promote-corpus.ts's parallel fix.
 *
 * FIXED (ID-57.7 policy-vs-test resolution): `question_matches` is
 * deliberately classified INTERNAL_ONLY_TABLES by check-api-view-coverage.ts
 * — no `api.question_matches` view exists BY POLICY (RPC-only access
 * surface). Confirmed empirically: `api.question_matches` 404s
 * ("Could not find the table"), and a PostgREST request with
 * `Accept-Profile: public` 406s ("Only the following schemas are exposed:
 * api") — the ID-115 schema-isolation cutover (20260623) makes `public`
 * UNREACHABLE via PostgREST/supabase-js entirely, not just unexposed for
 * this one table. No production caller reads `question_matches` directly
 * (grep across app/lib/components/hooks/scripts + ast-dataflow
 * string-literal-uses: zero hits outside these two integration test files
 * and the policy classification itself) — the reader RPC
 * `question_match_search` IS the designed read surface. This suite now
 * reads materialised rows through that RPC instead of
 * `.from('question_matches')` (which silently 404s under the api-routed
 * `DB_OPTION` client). One PRODUCT invariant (E3's `matched_at` bookkeeping
 * column) is not independently observable through the RPC surface — the
 * reader never returns `matched_at` — so Test 3 now proves "last-scored-
 * visible" by asserting the STORED score changes (not merely persists) after
 * a second recompute with a different query embedding, which is the
 * stronger, contract-visible form of the same invariant. `afterEach` no
 * longer issues a belt-and-braces `question_matches` delete (it 404s the
 * same way) — the `q_a_pairs`/`form_questions` deletes already CASCADE
 * (`question_matches_form_question_id_fkey` / `_q_a_pair_id_fkey` are both
 * `ON DELETE CASCADE`, confirmed in the squash baseline), so cleanup is
 * unaffected.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { DB_OPTION } from '@/lib/supabase/schema';
import { findProjectRoot } from '@/__tests__/integration/helpers/find-project-root';

// ---------------------------------------------------------------------------
// Environment bootstrap (same pattern as two-step-retrieval.integration.test.ts)
// ---------------------------------------------------------------------------
// bl-356: shared fail-loud helper replaces the inline findProjectRoot copy that
// silently returned process.cwd() on miss (the bl-292 .env-only bug). In CI the
// env vars are injected directly (no .env on disk) so the helper throws — fall
// back to ambient process.env; the env guard below is the real config gate.
let projectRoot: string | null = null;
try {
  projectRoot = findProjectRoot();
} catch {
  projectRoot = null;
}
if (projectRoot) {
  config({ path: resolve(projectRoot, '.env') });
  config({ path: resolve(projectRoot, '.env.local'), override: true });
}

// ---------------------------------------------------------------------------
// KH_RUN_INTEGRATION gate
// ---------------------------------------------------------------------------
const RUN_INTEGRATION = Boolean(process.env.KH_RUN_INTEGRATION);

// ---------------------------------------------------------------------------
// Service-role client (bypasses RLS for setup/teardown).
// ---------------------------------------------------------------------------
let db: SupabaseClient<Database>;

if (RUN_INTEGRATION) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'ID-57 {57.6} integration tests require NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }

  // ID-115 (S9): route to the exposed api schema
  db = createClient<Database>(url, key, { ...DB_OPTION });
}

// ---------------------------------------------------------------------------
// Test ID tracking for FK-safe cleanup.
// ---------------------------------------------------------------------------
let seededPairIds: string[] = [];
let seededQuestionIds: string[] = [];
let seededWorkspaceIds: string[] = [];

// ---------------------------------------------------------------------------
// Embedding vector helpers — 1024-dim with distinct leading dimensions so the
// cosine ordering between seeded pairs is deterministic.
// ---------------------------------------------------------------------------
function makeEmbedding(d0: number, d1 = 0): number[] {
  const vec = Array(1024).fill(0) as number[];
  vec[0] = d0;
  vec[1] = d1;
  return vec;
}

// Cosine distance between two vectors that share this 1024-dim shape, so the
// test can assert stored embedding_score ≈ 1.0 - cosine_distance independently
// of the DB's pgvector implementation.
function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

// ---------------------------------------------------------------------------
// Seed helpers.
// ---------------------------------------------------------------------------
async function seedWorkspace(name: string): Promise<string> {
  const { data: appType, error: appTypeErr } = await db
    .from('application_types')
    .select('id')
    .limit(1)
    .single();

  if (appTypeErr || !appType) {
    throw new Error(
      `seedWorkspace: no application_types row found — ${appTypeErr?.message ?? 'no data'}`,
    );
  }

  const { data, error } = await db
    .from('workspaces')
    .insert({ name, application_type_id: appType.id })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`seedWorkspace failed: ${error?.message ?? 'no data'}`);
  }

  seededWorkspaceIds.push(data.id);
  return data.id;
}

async function seedFormQuestion(
  workspaceId: string,
  questionText: string,
): Promise<string> {
  const { data, error } = await db
    .from('form_questions')
    .insert({
      workspace_id: workspaceId,
      question_text: questionText,
      section_name: 'ID-57.6 test section',
      section_sequence: 1,
      question_sequence: 1,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`seedFormQuestion failed: ${error?.message ?? 'no data'}`);
  }

  seededQuestionIds.push(data.id);
  return data.id;
}

const EMBEDDING_MODEL = 'text-embedding-3-large';

/**
 * ID-131.19 M6-adjacent: q_a_pairs.question_embedding DROPPED — vector
 * storage lives on the polymorphic record_embeddings table.
 */
async function insertEmbedding(
  pairId: string,
  embedding: number[],
): Promise<void> {
  const { error } = await db.from('record_embeddings').insert({
    owner_kind: 'q_a_pair',
    owner_id: pairId,
    model: EMBEDDING_MODEL,
    embedding: JSON.stringify(embedding),
  });
  if (error) {
    throw new Error(`insertEmbedding(${pairId}) failed: ${error.message}`);
  }
}

async function seedQaPair(opts: {
  questionText: string;
  answerStandard: string;
  publicationStatus: 'draft' | 'in_review' | 'published' | 'archived';
  embedding?: number[];
  scopeTag?: string[];
  antiScopeTag?: string[];
}): Promise<string> {
  const payload: Database['public']['Tables']['q_a_pairs']['Insert'] = {
    question_text: opts.questionText,
    answer_standard: opts.answerStandard,
    publication_status: opts.publicationStatus,
    scope_tag: opts.scopeTag ?? [],
    anti_scope_tag: opts.antiScopeTag ?? [],
    origin_kind: 'curated_explicit',
  };

  const { data, error } = await db
    .from('q_a_pairs')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`seedQaPair failed: ${error?.message ?? 'no data'}`);
  }

  seededPairIds.push(data.id);
  if (opts.embedding) {
    await insertEmbedding(data.id, opts.embedding);
  }
  return data.id;
}

// ---------------------------------------------------------------------------
// Writer RPC invocation (untyped-client decoupling).
// ---------------------------------------------------------------------------
// question_match_recompute is introduced by migration 20260615165758, whose
// database.types.ts regen rides the {57.7}/{64.8} combined cutover apply (the
// generated types are a guarded/CI-owned artefact, intentionally NOT regenerated
// in this Subtask). Until that lands, the strict supabase-js .rpc() overload
// cannot resolve the not-yet-generated function name off the stale type, so we
// invoke it via an untyped client view (same decoupling pattern the sibling
// two-step-retrieval test applies for not-yet-regenerated columns). The call
// still runs against the live STAGING DB at {57.7}, so the assertions verify
// real RPC behaviour — only the compile-time function-name overload is decoupled.
interface RecomputeArgs {
  p_form_question_id: string;
  p_query: string;
  p_query_embedding: string; // JSON.stringify(number[]) — CLAUDE.md vector gotcha
  p_question_kind: string;
  p_scope_tag: string[];
  p_anti_scope_tag: string[];
  p_limit: number;
}

async function recompute(
  args: RecomputeArgs,
): Promise<{ data: number | null; error: { message: string } | null }> {
  // FIXED — see module docstring: this RPC now JOINs record_embeddings
  // (20260706170000_id131_qa_fns_record_embeddings_repoint.sql, authored,
  // pending owner-gated apply).
  const { data, error } = await (db as unknown as SupabaseClient).rpc(
    'question_match_recompute',
    args,
  );
  return { data: data as number | null, error };
}

// ---------------------------------------------------------------------------
// Read materialised candidate edges through the sanctioned reader RPC — see
// module docstring (ID-57.7 fix): `question_matches` is INTERNAL_ONLY_TABLES
// (no api view by policy), so direct `.from('question_matches')` 404s under
// the api-routed client. `question_match_search` is the designed read
// surface; it returns STORED per-method scores with zero re-scoring, so the
// values read here are the same numbers the writer materialised.
// ---------------------------------------------------------------------------
interface SearchRow {
  q_a_pair_id: string;
  question_text_preview: string;
  answer_standard_preview: string;
  embedding_score: number | null;
  fulltext_score: number | null;
  scope_tag: string[] | null;
  publication_status: string;
}

interface SearchArgs {
  p_form_question_id: string;
  p_question_kind?: string | null;
  p_limit?: number;
}

async function search(
  args: SearchArgs,
): Promise<{ data: SearchRow[] | null; error: { message: string } | null }> {
  const { data, error } = await (db as unknown as SupabaseClient).rpc(
    'question_match_search',
    args,
  );
  return { data: data as SearchRow[] | null, error };
}

// ---------------------------------------------------------------------------
// Cleanup — FK-safe order: q_a_pairs → form_questions → workspaces.
// question_matches rows CASCADE-delete from both parents
// (question_matches_form_question_id_fkey / _q_a_pair_id_fkey are both
// ON DELETE CASCADE — squash baseline), so no explicit question_matches
// delete is needed. (ID-57.7 fix: an explicit `.from('question_matches')`
// delete would 404 anyway — INTERNAL_ONLY_TABLES, no api view — see module
// docstring.)
// ---------------------------------------------------------------------------
afterEach(async () => {
  if (!RUN_INTEGRATION) return;

  if (seededPairIds.length > 0) {
    // record_embeddings carries no FK (polymorphic owner) — clean explicitly.
    await db
      .from('record_embeddings')
      .delete()
      .eq('owner_kind', 'q_a_pair')
      .in('owner_id', seededPairIds);
    await db.from('q_a_pairs').delete().in('id', seededPairIds);
  }
  if (seededQuestionIds.length > 0) {
    await db.from('form_questions').delete().in('id', seededQuestionIds);
  }
  if (seededWorkspaceIds.length > 0) {
    await db.from('workspaces').delete().in('id', seededWorkspaceIds);
  }

  seededPairIds = [];
  seededQuestionIds = [];
  seededWorkspaceIds = [];
});

// ===========================================================================
// Suite
// ===========================================================================

describe.skipIf(!RUN_INTEGRATION)(
  'ID-57 {57.6} — question_match_recompute writer RPC',
  () => {
    beforeAll(async () => {
      // ID-57.7 fix: preflight through the reader RPC (the sanctioned access
      // surface), not `.from('question_matches')` (404s — INTERNAL_ONLY_TABLES,
      // no api view). A well-formed but non-existent form_question_id must
      // return an empty list, not an error (C5) — proves the RPC + underlying
      // table both exist and the {57.7} migration is applied.
      const { error } = await search({
        p_form_question_id: '00000000-0000-4000-8000-000000000000',
        p_limit: 1,
      });
      if (error) {
        throw new Error(
          `Staging DB connection check failed: ${error.message}. ` +
            'Ensure NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set ' +
            'and the {57.7} combined migration has been applied to staging.',
        );
      }
    });

    // -------------------------------------------------------------------------
    // Test 1: recompute materialises ranked rows with both scores + kind,
    // and returns the count (PRODUCT E1/E2; A5).
    // -------------------------------------------------------------------------
    it('materialises ranked candidate rows with both scores and question_kind stored; returns count', async () => {
      const workspaceId = await seedWorkspace('ID-57.6 recompute workspace');
      const formQuestionId = await seedFormQuestion(
        workspaceId,
        'How do we demonstrate GDPR compliance to clients?',
      );

      const queryEmbedding = makeEmbedding(1.0, 0.5);

      // Two eligible (published, embedded, scope-overlapping) pairs. Pair A is
      // closer to the query vector than pair B.
      const pairAEmbedding = makeEmbedding(1.0, 0.5); // closest
      const pairBEmbedding = makeEmbedding(0.2, 0.0);

      const pairAId = await seedQaPair({
        questionText: 'How is GDPR compliance demonstrated to clients?',
        answerStandard:
          'GDPR compliance requires documented data processing activities and DPA agreements.',
        publicationStatus: 'published',
        embedding: pairAEmbedding,
        scopeTag: ['procurement'],
      });
      const pairBId = await seedQaPair({
        questionText: 'What certifications does the organisation hold?',
        answerStandard:
          'The organisation holds Cyber Essentials Plus and ISO 9001.',
        publicationStatus: 'published',
        embedding: pairBEmbedding,
        scopeTag: ['procurement'],
      });

      const { data: count, error } = await recompute({
        p_form_question_id: formQuestionId,
        p_query: 'GDPR compliance documentation',
        p_query_embedding: JSON.stringify(queryEmbedding), // CLAUDE.md: must stringify
        p_question_kind: 'bid',
        p_scope_tag: ['procurement'],
        p_anti_scope_tag: [],
        p_limit: 20,
      });

      expect(
        error,
        `question_match_recompute failed: ${error?.message}`,
      ).toBeNull();
      // E2: returns the count of materialised rows.
      expect(count).toBe(2);

      // Read the materialised edges back through the reader RPC — the
      // sanctioned access surface (ID-57.7 fix; see module docstring).
      // A4 (question_kind stored verbatim): filtering by 'bid' returns both
      // pairs, proving the caller-supplied kind was persisted as 'bid'.
      const { data: matches, error: searchError } = await search({
        p_form_question_id: formQuestionId,
        p_question_kind: 'bid',
      });
      expect(searchError, `search failed: ${searchError?.message}`).toBeNull();
      expect(matches!.length, 'two candidate edges materialised').toBe(2);

      const byPair = new Map(matches!.map((m) => [m.q_a_pair_id, m]));
      expect(byPair.has(pairAId)).toBe(true);
      expect(byPair.has(pairBId)).toBe(true);

      for (const m of matches!) {
        // A5: at least one score present; here both methods produce a score.
        expect(typeof m.embedding_score, 'embedding_score is a number').toBe(
          'number',
        );
        expect(m.embedding_score).toBeGreaterThanOrEqual(0);
        expect(m.embedding_score).toBeLessThanOrEqual(1);
        expect(typeof m.fulltext_score, 'fulltext_score is a number').toBe(
          'number',
        );
        expect(m.fulltext_score).toBeGreaterThanOrEqual(0);
      }

      // Pair A (closest embedding) outscores pair B on the embedding axis.
      const matchA = byPair.get(pairAId)!;
      const matchB = byPair.get(pairBId)!;
      expect(
        matchA.embedding_score,
        'closer pair has the higher embedding_score',
      ).toBeGreaterThan(matchB.embedding_score!);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 2: corpus eligibility filters (PRODUCT B5/B6). Pairs excluded for
    // non-overlapping scope, anti-scope overlap, non-published, NULL embedding.
    // -------------------------------------------------------------------------
    it('excludes pairs by scope, anti-scope, publication_status, and NULL embedding', async () => {
      const workspaceId = await seedWorkspace('ID-57.6 eligibility workspace');
      const formQuestionId = await seedFormQuestion(
        workspaceId,
        'What is our information security posture?',
      );

      const embedding = makeEmbedding(1.0, 0.0);

      // The ONE eligible pair: published, embedded, scope overlaps, no anti-scope.
      const eligibleId = await seedQaPair({
        questionText: 'What is our ISO 27001 information security posture?',
        answerStandard: 'We operate a certified ISMS under ISO 27001.',
        publicationStatus: 'published',
        embedding,
        scopeTag: ['procurement'],
        antiScopeTag: [],
      });

      // Excluded: scope does not overlap the caller scope.
      const nonOverlapId = await seedQaPair({
        questionText: 'Out-of-scope security question.',
        answerStandard: 'Out-of-scope answer.',
        publicationStatus: 'published',
        embedding,
        scopeTag: ['sales'],
      });

      // Excluded: anti-scope overlaps the caller scope (B5 exclusion).
      const antiScopeId = await seedQaPair({
        questionText: 'Anti-scoped security question.',
        answerStandard: 'Anti-scoped answer.',
        publicationStatus: 'published',
        embedding,
        scopeTag: ['procurement'],
        antiScopeTag: ['procurement'],
      });

      // Excluded: not published (draft).
      const draftId = await seedQaPair({
        questionText: 'Draft security question.',
        answerStandard: 'Draft answer.',
        publicationStatus: 'draft',
        embedding,
        scopeTag: ['procurement'],
      });

      // Excluded: NULL question_embedding (not embedding-eligible).
      const noEmbeddingId = await seedQaPair({
        questionText: 'Unembedded security question.',
        answerStandard: 'Unembedded answer.',
        publicationStatus: 'published',
        scopeTag: ['procurement'],
        // no embedding
      });

      const { data: count, error } = await recompute({
        p_form_question_id: formQuestionId,
        p_query: 'information security ISO 27001',
        p_query_embedding: JSON.stringify(makeEmbedding(1.0, 0.0)),
        p_question_kind: 'bid',
        p_scope_tag: ['procurement'],
        p_anti_scope_tag: [],
        p_limit: 20,
      });

      expect(
        error,
        `question_match_recompute failed: ${error?.message}`,
      ).toBeNull();
      // Only the single eligible pair is materialised.
      expect(count).toBe(1);

      // Read back through the reader RPC (ID-57.7 fix; see module docstring).
      const { data: matches, error: searchError } = await search({
        p_form_question_id: formQuestionId,
      });
      expect(searchError, `search failed: ${searchError?.message}`).toBeNull();
      const materialisedPairIds = matches!.map((m) => m.q_a_pair_id);
      expect(materialisedPairIds).toEqual([eligibleId]);
      expect(materialisedPairIds).not.toContain(nonOverlapId);
      expect(materialisedPairIds).not.toContain(antiScopeId);
      expect(materialisedPairIds).not.toContain(draftId);
      expect(materialisedPairIds).not.toContain(noEmbeddingId);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 3: idempotent re-compute — no duplicate edge (A6 UNIQUE holds) and
    // the row is last-scored-visible, i.e. genuinely refreshed rather than
    // stale (PRODUCT E2/E3; ON CONFLICT upsert).
    //
    // ID-57.7 fix (see module docstring): E3's `matched_at` bookkeeping column
    // is not returned by `question_match_search` (the sanctioned reader), so
    // it is not independently observable through the RPC contract. This test
    // instead proves "last-scored-visible" the contract-visible way: a second
    // recompute with a MATERIALLY DIFFERENT query embedding must change the
    // STORED embedding_score visible via search — if the row were stale
    // (not refreshed), the first score would persist. This is the stronger
    // form of the same invariant: it proves the *content* reflects the last
    // scoring, not just that a timestamp column advanced.
    // -------------------------------------------------------------------------
    it('re-compute leaves no duplicate edge and the stored score reflects the latest scoring', async () => {
      const workspaceId = await seedWorkspace('ID-57.6 idempotency workspace');
      const formQuestionId = await seedFormQuestion(
        workspaceId,
        'What is our data residency policy?',
      );

      const pairEmbedding = makeEmbedding(1.0, 0.0);
      const pairId = await seedQaPair({
        questionText: 'What is our data residency policy?',
        answerStandard: 'Data is held within UK/EU regions per contract.',
        publicationStatus: 'published',
        embedding: pairEmbedding,
        scopeTag: ['procurement'],
      });

      const baseArgs = {
        p_form_question_id: formQuestionId,
        p_question_kind: 'bid',
        p_scope_tag: ['procurement'],
        p_anti_scope_tag: [],
        p_limit: 20,
      };

      // First recompute: query embedding close to the pair → high embedding_score.
      const first = await recompute({
        ...baseArgs,
        p_query: 'data residency UK EU',
        p_query_embedding: JSON.stringify(makeEmbedding(1.0, 0.0)),
      });
      expect(
        first.error,
        `first recompute: ${first.error?.message}`,
      ).toBeNull();
      expect(first.data).toBe(1);

      const afterFirst = await search({ p_form_question_id: formQuestionId });
      expect(afterFirst.error).toBeNull();
      expect(afterFirst.data!.length).toBe(1);
      expect(afterFirst.data![0].q_a_pair_id).toBe(pairId);
      const firstEmbeddingScore = afterFirst.data![0].embedding_score!;

      // Second recompute: query embedding ORTHOGONAL to the pair (dot product
      // 0 → cosine_distance 1 → embedding_score 0, the valid lower boundary)
      // — materially lower than the first, without going negative (an
      // ANTI-PARALLEL query, e.g. makeEmbedding(-1.0, 0.0), drives
      // cosine_distance to 2 and would raw-compute embedding_score to -1.0,
      // which would violate the table's own `embedding_score_range_chk`
      // [0,1] CHECK — confirmed live against staging; FIXED at ID-57.9 via a
      // GREATEST(0, LEAST(1, ...)) clamp in
      // 20260709234230_id57_clamp_question_match_embedding_score.sql,
      // exercised directly by the anti-parallel-embedding test below). If
      // the upsert left the row stale, the reader would still surface the
      // first (high) score.
      const second = await recompute({
        ...baseArgs,
        p_query: 'unrelated procurement terminology',
        p_query_embedding: JSON.stringify(makeEmbedding(0.0, 1.0)),
      });
      expect(
        second.error,
        `second recompute: ${second.error?.message}`,
      ).toBeNull();
      expect(second.data).toBe(1);

      const afterSecond = await search({ p_form_question_id: formQuestionId });
      expect(afterSecond.error).toBeNull();
      // A6 UNIQUE holds — still exactly one edge for (form_question, pair).
      expect(
        afterSecond.data!.length,
        'no duplicate edge after re-compute (UNIQUE holds)',
      ).toBe(1);
      expect(afterSecond.data![0].q_a_pair_id).toBe(pairId);
      // Last-scored-visible: the stored score reflects the SECOND scoring,
      // not a stale first value.
      expect(
        afterSecond.data![0].embedding_score,
        'stored score reflects the latest scoring, not a stale value',
      ).toBeLessThan(firstEmbeddingScore);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 4: stored score fidelity (PRODUCT D1/D2/D3). embedding_score ≈
    // 1.0 - cosine_distance; a no-lexical-match query yields fulltext_score = 0
    // (not null).
    // -------------------------------------------------------------------------
    it('stores embedding_score ≈ 1.0 - cosine_distance and fulltext_score = 0 on no-term-match', async () => {
      const workspaceId = await seedWorkspace(
        'ID-57.6 score-fidelity workspace',
      );
      const formQuestionId = await seedFormQuestion(
        workspaceId,
        'Score fidelity probe.',
      );

      const pairEmbedding = makeEmbedding(0.8, 0.6);
      const queryEmbedding = makeEmbedding(1.0, 0.2);

      const pairId = await seedQaPair({
        questionText: 'Aardvark zeppelin quokka.',
        answerStandard: 'Xylophone marmalade.',
        publicationStatus: 'published',
        embedding: pairEmbedding,
        scopeTag: ['procurement'],
      });

      // Query text shares no lexical tokens with the pair → ts_rank = 0.
      const { data: count, error } = await recompute({
        p_form_question_id: formQuestionId,
        p_query: 'completely unrelated procurement terminology',
        p_query_embedding: JSON.stringify(queryEmbedding),
        p_question_kind: 'bid',
        p_scope_tag: ['procurement'],
        p_anti_scope_tag: [],
        p_limit: 20,
      });

      expect(error, `recompute failed: ${error?.message}`).toBeNull();
      expect(count).toBe(1);

      // Read back through the reader RPC (ID-57.7 fix; see module docstring)
      // — it returns the STORED scores verbatim, so the values asserted here
      // are the same numbers the writer materialised.
      const { data: matches, error: searchError } = await search({
        p_form_question_id: formQuestionId,
      });
      expect(searchError, `search failed: ${searchError?.message}`).toBeNull();
      expect(matches!.length).toBe(1);
      const m = matches![0];
      expect(m.q_a_pair_id).toBe(pairId);

      // D1/D2: embedding_score ≈ 1.0 - cosine_distance (stored numeric(5,4),
      // so allow the rounding tolerance of that scale).
      const expectedEmbeddingScore =
        1.0 - cosineDistance(pairEmbedding, queryEmbedding);
      expect(m.embedding_score).toBeCloseTo(expectedEmbeddingScore, 3);

      // D3: no lexical overlap → stored fulltext_score is 0, not null.
      expect(m.fulltext_score, 'no-term-match fulltext_score is 0').toBe(0);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 5 (ID-57.9 regression): an ANTI-PARALLEL query embedding drives
    // cosine_distance to 2, so the raw (1.0 - cosine_distance) expression
    // would be -1.0 — outside the [0,1] range enforced by
    // question_matches_embedding_score_range_chk. Pre-fix this crashed the
    // RPC with a raw Postgres constraint-violation error instead of
    // degrading (see supabase/migrations/20260709234230_id57_clamp_
    // question_match_embedding_score.sql). Post-fix, the
    // GREATEST(0, LEAST(1, ...)) clamp means the RPC succeeds and the stored
    // embedding_score reads back as 0 (the clamped floor), never -1.0 and
    // never an error.
    // -------------------------------------------------------------------------
    it('clamps embedding_score to 0 for an anti-parallel query embedding instead of violating the range CHECK (ID-57.9)', async () => {
      const workspaceId = await seedWorkspace(
        'ID-57.9 anti-parallel clamp workspace',
      );
      const formQuestionId = await seedFormQuestion(
        workspaceId,
        'Anti-parallel clamp probe.',
      );

      const pairEmbedding = makeEmbedding(1.0, 0.0);
      const pairId = await seedQaPair({
        questionText: 'Anti-parallel clamp probe pair.',
        answerStandard: 'Anti-parallel clamp probe answer.',
        publicationStatus: 'published',
        embedding: pairEmbedding,
        scopeTag: ['procurement'],
      });

      // Anti-parallel to the pair's embedding: dot product -1 →
      // cosine_distance 2 → raw (1.0 - distance) = -1.0, which would violate
      // question_matches_embedding_score_range_chk pre-fix.
      const antiParallelEmbedding = makeEmbedding(-1.0, 0.0);
      expect(
        cosineDistance(pairEmbedding, antiParallelEmbedding),
        'sanity: anti-parallel vectors are cosine_distance 2 (test fixture assumption)',
      ).toBeCloseTo(2, 5);

      const { data: count, error } = await recompute({
        p_form_question_id: formQuestionId,
        p_query: 'anti-parallel clamp probe',
        p_query_embedding: JSON.stringify(antiParallelEmbedding),
        p_question_kind: 'bid',
        p_scope_tag: ['procurement'],
        p_anti_scope_tag: [],
        p_limit: 20,
      });

      // ID-57.9: must NOT error — pre-fix this violated
      // question_matches_embedding_score_range_chk with a raw Postgres error.
      expect(
        error,
        `recompute must not error on an anti-parallel embedding post-clamp: ${error?.message}`,
      ).toBeNull();
      expect(count).toBe(1);

      const { data: matches, error: searchError } = await search({
        p_form_question_id: formQuestionId,
      });
      expect(searchError, `search failed: ${searchError?.message}`).toBeNull();
      expect(matches!.length).toBe(1);
      expect(matches![0].q_a_pair_id).toBe(pairId);
      // Clamped to the [0,1] floor, not the raw -1.0.
      expect(
        matches![0].embedding_score,
        'anti-parallel embedding_score clamps to 0, not -1.0',
      ).toBe(0);
    }, 60_000);
  },
);
