/**
 * ID-57 {57.6} T10 WP2 — Integration tests for the question_match_recompute
 * writer RPC (live scoring + population writer).
 *
 * Scope: specs/id-57-question-matches-retrieval/{PRODUCT,TECH}.md §E (writer).
 * Exercises:
 *   1. recompute materialises ranked candidate rows into question_matches with
 *      BOTH per-method scores + matched_at + the caller-supplied question_kind,
 *      and RETURNS the materialised row count (PRODUCT E1/E2; A5).
 *   2. corpus eligibility filters (PRODUCT B5/B6): non-overlapping scope,
 *      anti-scope overlap, non-'published', and NULL question_embedding pairs
 *      are excluded from the materialised candidate set.
 *   3. idempotent re-compute: a second recompute call leaves NO duplicate edge
 *      (the A6 UNIQUE (form_question_id, q_a_pair_id) holds) and REFRESHES
 *      matched_at on the surviving row (PRODUCT E2/E3; ON CONFLICT upsert).
 *   4. stored score fidelity (PRODUCT D1/D2/D3): embedding_score ≈
 *      1.0 - cosine_distance; fulltext_score = ts_rank(.,2), and a query with
 *      no lexical overlap yields a stored fulltext_score of 0 (not null).
 *
 * Sources of truth:
 *   * specs/id-57-question-matches-retrieval/TECH.md §E (writer DDL + scoring)
 *   * specs/id-57-question-matches-retrieval/PRODUCT.md §E (E1/E2/E3),
 *     §B (B5 scope/anti-scope, B6 eligibility), §D (D1/D2/D3 scoring)
 *   * Migration 20260613191008_id57_question_matches_table.sql (table shape +
 *     A6 UNIQUE + score range CHECKs)
 *   * Migration 20260615165758_id57_question_match_rpcs.sql (writer RPC)
 *
 * CLAUDE.md gotchas applied:
 *   * Embedding vector: JSON.stringify(embeddingArray) for RPC vector params,
 *     NOT a raw array.
 *   * Service-role client: bypasses RLS for test setup/teardown.
 *   * FK-safe cleanup order: question_matches → q_a_pairs → form_questions →
 *     workspaces (question_matches FKs cascade-delete from both parents, but we
 *     delete the edge rows explicitly first as belt-and-braces).
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
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Environment bootstrap (same pattern as two-step-retrieval.integration.test.ts)
// ---------------------------------------------------------------------------
function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    try {
      const result = config({ path: resolve(dir, '.env') });
      if (!result.error) return dir;
    } catch {
      /* continue */
    }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
config({ path: resolve(projectRoot, '.env') });
config({ path: resolve(projectRoot, '.env.local'), override: true });

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

  db = createClient<Database>(url, key);
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
    question_embedding: opts.embedding
      ? JSON.stringify(opts.embedding)
      : undefined,
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
  const { data, error } = await (db as unknown as SupabaseClient).rpc(
    'question_match_recompute',
    args,
  );
  return { data: data as number | null, error };
}

// ---------------------------------------------------------------------------
// Read materialised candidate edges for a form-question.
// ---------------------------------------------------------------------------
async function readMatches(formQuestionId: string) {
  const { data, error } = await db
    .from('question_matches')
    .select(
      'id, form_question_id, q_a_pair_id, question_kind, embedding_score, fulltext_score, matched_at',
    )
    .eq('form_question_id', formQuestionId);

  if (error) {
    throw new Error(`readMatches(${formQuestionId}) failed: ${error.message}`);
  }
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Cleanup — FK-safe order: question_matches → q_a_pairs → form_questions →
// workspaces. question_matches cascade-deletes from both parents, but we delete
// edge rows explicitly first (defensive).
// ---------------------------------------------------------------------------
afterEach(async () => {
  if (!RUN_INTEGRATION) return;

  if (seededQuestionIds.length > 0) {
    await db
      .from('question_matches')
      .delete()
      .in('form_question_id', seededQuestionIds);
  }
  if (seededPairIds.length > 0) {
    await db.from('question_matches').delete().in('q_a_pair_id', seededPairIds);
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
      const { error } = await db.from('question_matches').select('id').limit(1);
      if (error) {
        throw new Error(
          `Staging DB connection check failed: ${error.message}. ` +
            'Ensure NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set ' +
            'and the {57.7} combined migration has been applied to staging.',
        );
      }
    });

    // -------------------------------------------------------------------------
    // Test 1: recompute materialises ranked rows with both scores + kind +
    // matched_at, and returns the count (PRODUCT E1/E2; A5).
    // -------------------------------------------------------------------------
    it('materialises ranked candidate rows with both scores, question_kind, matched_at; returns count', async () => {
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

      const matches = await readMatches(formQuestionId);
      expect(matches.length, 'two candidate edges materialised').toBe(2);

      const byPair = new Map(matches.map((m) => [m.q_a_pair_id, m]));
      expect(byPair.has(pairAId)).toBe(true);
      expect(byPair.has(pairBId)).toBe(true);

      for (const m of matches) {
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
        // Caller-supplied question_kind is stored verbatim (A4).
        expect(m.question_kind).toBe('bid');
        // matched_at is set.
        expect(m.matched_at).toBeDefined();
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

      const matches = await readMatches(formQuestionId);
      const materialisedPairIds = matches.map((m) => m.q_a_pair_id);
      expect(materialisedPairIds).toEqual([eligibleId]);
      expect(materialisedPairIds).not.toContain(nonOverlapId);
      expect(materialisedPairIds).not.toContain(antiScopeId);
      expect(materialisedPairIds).not.toContain(draftId);
      expect(materialisedPairIds).not.toContain(noEmbeddingId);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 3: idempotent re-compute — no duplicate edge (A6 UNIQUE holds) and
    // matched_at is refreshed (PRODUCT E2/E3; ON CONFLICT upsert).
    // -------------------------------------------------------------------------
    it('re-compute leaves no duplicate edge and refreshes matched_at', async () => {
      const workspaceId = await seedWorkspace('ID-57.6 idempotency workspace');
      const formQuestionId = await seedFormQuestion(
        workspaceId,
        'What is our data residency policy?',
      );

      const embedding = makeEmbedding(1.0, 0.0);
      const pairId = await seedQaPair({
        questionText: 'What is our data residency policy?',
        answerStandard: 'Data is held within UK/EU regions per contract.',
        publicationStatus: 'published',
        embedding,
        scopeTag: ['procurement'],
      });

      const rpcArgs = {
        p_form_question_id: formQuestionId,
        p_query: 'data residency UK EU',
        p_query_embedding: JSON.stringify(makeEmbedding(1.0, 0.0)),
        p_question_kind: 'bid',
        p_scope_tag: ['procurement'],
        p_anti_scope_tag: [],
        p_limit: 20,
      };

      const first = await recompute(rpcArgs);
      expect(
        first.error,
        `first recompute: ${first.error?.message}`,
      ).toBeNull();
      expect(first.data).toBe(1);

      const afterFirst = await readMatches(formQuestionId);
      expect(afterFirst.length).toBe(1);
      const firstMatchedAt = afterFirst[0].matched_at;
      expect(afterFirst[0].q_a_pair_id).toBe(pairId);

      // Brief delay so the refreshed matched_at is strictly later.
      await new Promise((r) => setTimeout(r, 1100));

      const second = await recompute(rpcArgs);
      expect(
        second.error,
        `second recompute: ${second.error?.message}`,
      ).toBeNull();
      expect(second.data).toBe(1);

      const afterSecond = await readMatches(formQuestionId);
      // A6 UNIQUE holds — still exactly one edge for (form_question, pair).
      expect(
        afterSecond.length,
        'no duplicate edge after re-compute (UNIQUE holds)',
      ).toBe(1);
      // matched_at refreshed by the ON CONFLICT upsert.
      expect(
        new Date(afterSecond[0].matched_at).getTime(),
        'matched_at refreshed on re-compute',
      ).toBeGreaterThan(new Date(firstMatchedAt).getTime());
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

      const matches = await readMatches(formQuestionId);
      expect(matches.length).toBe(1);
      const m = matches[0];
      expect(m.q_a_pair_id).toBe(pairId);

      // D1/D2: embedding_score ≈ 1.0 - cosine_distance (stored numeric(5,4),
      // so allow the rounding tolerance of that scale).
      const expectedEmbeddingScore =
        1.0 - cosineDistance(pairEmbedding, queryEmbedding);
      expect(m.embedding_score).toBeCloseTo(expectedEmbeddingScore, 3);

      // D3: no lexical overlap → stored fulltext_score is 0, not null.
      expect(m.fulltext_score, 'no-term-match fulltext_score is 0').toBe(0);
    }, 60_000);
  },
);
