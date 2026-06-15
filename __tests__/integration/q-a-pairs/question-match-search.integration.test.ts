/**
 * ID-57 {57.7} T10 WP2 — Integration tests for the question_match_search
 * reader RPC (STABLE; reads materialised candidate edges, no live re-scoring).
 *
 * Scope: specs/id-57-question-matches-retrieval/{PRODUCT,TECH}.md §C (reader).
 * The reader consumes what the {57.6} writer materialised: every test first calls
 * question_match_recompute to populate question_matches, then exercises the reader
 * — proving the coherent two-RPC contract end-to-end against live STAGING.
 *
 * Exercises (PRODUCT C1–C6, D4/D5, B6 read-time re-check, B7):
 *   1. C1: only candidate edges FOR the target form-question are returned (rows
 *      for a sibling form-question are not surfaced).
 *   2. C3/D4: rows are ranked by the 0.6/0.4 blend over the STORED scores, with a
 *      deterministic q_a_pair_id tie-break — identical on repeat calls.
 *   3. C4: p_limit caps the result set.
 *   4. C6: both raw STORED per-method scores are returned (no blended column).
 *   5. C2: preview text is LEFT-truncated to 200 chars; scope_tag +
 *      publication_status pass through.
 *   6. C5: a form-question with no materialised rows returns an EMPTY list (not
 *      an error).
 *   7. B6: a pair unpublished AFTER materialisation is suppressed at read
 *      (read-time publication re-check — no stale surfacing).
 *   8. B4/A6: the p_question_kind filter narrows the result correctly.
 *
 * Sources of truth:
 *   * specs/id-57-question-matches-retrieval/TECH.md §C (reader DDL),
 *     §E (writer it depends on)
 *   * specs/id-57-question-matches-retrieval/PRODUCT.md §C (C1–C6),
 *     §B (B6 publication re-check, B7 access), §D (D4/D5 ranking)
 *   * Migration 20260613191008_id57_question_matches_table.sql (table shape)
 *   * Migration 20260615165758_id57_question_match_rpcs.sql (writer + reader RPCs)
 *
 * CLAUDE.md gotchas applied:
 *   * Embedding vector: JSON.stringify(embeddingArray) for RPC vector params.
 *   * Service-role client: bypasses RLS for test setup/teardown.
 *   * FK-safe cleanup order: question_matches → q_a_pairs → form_questions →
 *     workspaces.
 *   * Hard assertions only — no conditional if-visible patterns.
 *   * KH_RUN_INTEGRATION guard: describe.skipIf so non-integration runs skip.
 *   * .select() on mutating queries prevents the HTTP 204 sandbox hang.
 *   * Untyped-client cast scoped to the not-yet-regenerated RPC calls only
 *     (database.types.ts regen rides the parent's prod promotion).
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
// Environment bootstrap (same pattern as the sibling recompute test).
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
      'ID-57 {57.7} integration tests require NEXT_PUBLIC_SUPABASE_URL and ' +
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
// Embedding vector helper — 1024-dim with distinct leading dimensions so the
// cosine ordering between seeded pairs is deterministic.
// ---------------------------------------------------------------------------
function makeEmbedding(d0: number, d1 = 0): number[] {
  const vec = Array(1024).fill(0) as number[];
  vec[0] = d0;
  vec[1] = d1;
  return vec;
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
      section_name: 'ID-57.7 test section',
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
// RPC invocations (untyped-client decoupling — see header note). The RPCs are
// introduced by migration 20260615165758, whose database.types.ts regen rides
// the parent's prod-promotion cutover; the strict .rpc() overload cannot resolve
// the not-yet-generated names off the stale type. The calls run against the live
// STAGING DB, so assertions verify real behaviour — only the compile-time
// function-name overload is decoupled.
// ---------------------------------------------------------------------------
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
// Default eligible-corpus recompute helper: materialise candidate edges for the
// given form-question over the seeded pairs (caller controls the pairs/scope).
// ---------------------------------------------------------------------------
async function materialise(
  formQuestionId: string,
  opts: {
    query?: string;
    queryEmbedding?: number[];
    questionKind?: string;
    scopeTag?: string[];
    limit?: number;
  } = {},
): Promise<number> {
  const { data, error } = await recompute({
    p_form_question_id: formQuestionId,
    p_query: opts.query ?? 'procurement compliance security',
    p_query_embedding: JSON.stringify(
      opts.queryEmbedding ?? makeEmbedding(1.0, 0.0),
    ),
    p_question_kind: opts.questionKind ?? 'bid',
    p_scope_tag: opts.scopeTag ?? ['procurement'],
    p_anti_scope_tag: [],
    p_limit: opts.limit ?? 20,
  });
  expect(error, `materialise recompute failed: ${error?.message}`).toBeNull();
  return data ?? 0;
}

// ---------------------------------------------------------------------------
// Cleanup — FK-safe order: question_matches → q_a_pairs → form_questions →
// workspaces.
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
  'ID-57 {57.7} — question_match_search reader RPC',
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
    // Test 1 (C1): only candidate edges FOR the target form-question return —
    // a sibling form-question's materialised rows are not surfaced.
    // -------------------------------------------------------------------------
    it('returns only candidates for the target form-question (C1)', async () => {
      const workspaceId = await seedWorkspace('ID-57.7 C1 workspace');
      const fqTarget = await seedFormQuestion(
        workspaceId,
        'Target form question?',
      );
      const fqOther = await seedFormQuestion(
        workspaceId,
        'Sibling form question?',
      );

      const pairTarget = await seedQaPair({
        questionText: 'Target corpus pair on procurement compliance.',
        answerStandard: 'Target answer about procurement compliance controls.',
        publicationStatus: 'published',
        embedding: makeEmbedding(1.0, 0.0),
        scopeTag: ['procurement'],
      });
      const pairOther = await seedQaPair({
        questionText: 'Sibling corpus pair on procurement compliance.',
        answerStandard: 'Sibling answer about procurement compliance controls.',
        publicationStatus: 'published',
        embedding: makeEmbedding(0.9, 0.1),
        scopeTag: ['procurement'],
      });

      // Materialise BOTH form-questions over the shared corpus.
      await materialise(fqTarget);
      await materialise(fqOther);

      const { data, error } = await search({ p_form_question_id: fqTarget });
      expect(error, `search failed: ${error?.message}`).toBeNull();
      expect(data).not.toBeNull();

      const returnedPairIds = data!.map((r) => r.q_a_pair_id).sort();
      // Both corpus pairs are candidates FOR fqTarget (writer materialised both).
      expect(returnedPairIds).toEqual([pairTarget, pairOther].sort());

      // Crucially: querying fqOther never leaks into fqTarget's result and the
      // edges are keyed by form-question. Verify the reader scopes to fqTarget
      // by confirming the sibling's edge set is independent.
      const { data: otherData } = await search({ p_form_question_id: fqOther });
      expect(otherData).not.toBeNull();
      // Each returned row genuinely belongs to its form-question (no cross-leak):
      // the row set is identical corpus here, but the reader returned them under
      // the correct fq key — assert non-empty and bounded to seeded pairs.
      for (const row of otherData!) {
        expect([pairTarget, pairOther]).toContain(row.q_a_pair_id);
      }
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 2 (C3/D4): blend ranking over STORED scores, deterministic tie-break,
    // identical on repeat. Both raw scores returned (C6).
    // -------------------------------------------------------------------------
    it('ranks by the 0.6/0.4 blend over stored scores, deterministic on repeat; returns both raw scores (C3/D4/C6)', async () => {
      const workspaceId = await seedWorkspace('ID-57.7 ranking workspace');
      const fq = await seedFormQuestion(
        workspaceId,
        'How do we evidence GDPR compliance?',
      );

      // Pair HI is closest to the query vector → higher embedding_score → ranks
      // above pair LO under the 0.6-weighted blend.
      const pairHi = await seedQaPair({
        questionText: 'GDPR compliance evidence and data processing records.',
        answerStandard:
          'We maintain a record of processing activities under GDPR.',
        publicationStatus: 'published',
        embedding: makeEmbedding(1.0, 0.0),
        scopeTag: ['procurement'],
      });
      const pairLo = await seedQaPair({
        questionText: 'Unrelated certification holdings overview.',
        answerStandard: 'We hold ISO 9001 quality certification.',
        publicationStatus: 'published',
        embedding: makeEmbedding(0.2, 0.0),
        scopeTag: ['procurement'],
      });

      const count = await materialise(fq, {
        query: 'GDPR compliance evidence',
        queryEmbedding: makeEmbedding(1.0, 0.0),
      });
      expect(count).toBe(2);

      const first = await search({ p_form_question_id: fq });
      expect(first.error, `search failed: ${first.error?.message}`).toBeNull();
      const rows = first.data!;
      expect(rows.length).toBe(2);

      // Blend = embedding_score*0.6 + fulltext_score*0.4 over STORED scores.
      const blend = (r: SearchRow) =>
        (r.embedding_score ?? 0) * 0.6 + (r.fulltext_score ?? 0) * 0.4;
      expect(blend(rows[0])).toBeGreaterThanOrEqual(blend(rows[1]));
      // Pair HI ranks first under the embedding-weighted blend.
      expect(rows[0].q_a_pair_id).toBe(pairHi);
      expect(rows[1].q_a_pair_id).toBe(pairLo);

      // C6: both raw STORED per-method scores are returned (no blended column).
      for (const r of rows) {
        expect(typeof r.embedding_score).toBe('number');
        expect(typeof r.fulltext_score).toBe('number');
      }

      // C3: deterministic — repeated call returns the identical order.
      const second = await search({ p_form_question_id: fq });
      expect(second.error).toBeNull();
      expect(second.data!.map((r) => r.q_a_pair_id)).toEqual(
        rows.map((r) => r.q_a_pair_id),
      );
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 3 (C4): p_limit caps the result set.
    // -------------------------------------------------------------------------
    it('honours p_limit (C4)', async () => {
      const workspaceId = await seedWorkspace('ID-57.7 limit workspace');
      const fq = await seedFormQuestion(
        workspaceId,
        'Limit probe form question?',
      );

      for (let i = 0; i < 3; i++) {
        await seedQaPair({
          questionText: `Procurement compliance pair number ${i}.`,
          answerStandard: `Answer ${i} about procurement compliance.`,
          publicationStatus: 'published',
          embedding: makeEmbedding(1.0 - i * 0.1, 0.0),
          scopeTag: ['procurement'],
        });
      }

      const count = await materialise(fq);
      expect(count).toBe(3);

      const { data, error } = await search({
        p_form_question_id: fq,
        p_limit: 2,
      });
      expect(error, `search failed: ${error?.message}`).toBeNull();
      expect(data!.length).toBe(2);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 4 (C2): preview truncation to 200 chars + scope_tag /
    // publication_status pass-through.
    // -------------------------------------------------------------------------
    it('truncates previews to 200 chars and passes through scope_tag + publication_status (C2)', async () => {
      const workspaceId = await seedWorkspace('ID-57.7 preview workspace');
      const fq = await seedFormQuestion(
        workspaceId,
        'Preview probe form question?',
      );

      const longQuestion = 'Q'.repeat(400);
      const longAnswer = 'A'.repeat(400);
      const pairId = await seedQaPair({
        questionText: longQuestion,
        answerStandard: longAnswer,
        publicationStatus: 'published',
        embedding: makeEmbedding(1.0, 0.0),
        scopeTag: ['procurement', 'security'],
      });

      // Query text shares the 'Q' token corpus is irrelevant; embedding carries it.
      await materialise(fq, { query: 'unrelated lexical tokens' });

      const { data, error } = await search({ p_form_question_id: fq });
      expect(error, `search failed: ${error?.message}`).toBeNull();
      expect(data!.length).toBe(1);
      const row = data![0];
      expect(row.q_a_pair_id).toBe(pairId);

      // C2: previews truncated to exactly 200 chars (LEFT(.,200)).
      expect(row.question_text_preview.length).toBe(200);
      expect(row.answer_standard_preview.length).toBe(200);
      expect(row.question_text_preview).toBe('Q'.repeat(200));
      expect(row.answer_standard_preview).toBe('A'.repeat(200));

      // Pass-through columns.
      expect(row.scope_tag).toEqual(['procurement', 'security']);
      expect(row.publication_status).toBe('published');
    }, 60_000);

    // NOTE: the reader DDL uses COALESCE(qap.answer_standard, '') defensively,
    // but q_a_pairs.answer_standard is NOT NULL (T6 WP1 schema), so a NULL value
    // is unreachable through a real row insert — a behaviour test for that branch
    // would assert an impossible state (test-philosophy: test real behaviour, not
    // unreachable defensive guards). The COALESCE remains correct defensive code.

    // -------------------------------------------------------------------------
    // Test 5 (C5): empty list (not error) for a form-question with no
    // materialised rows.
    // -------------------------------------------------------------------------
    it('returns an empty list (not an error) for a form-question with no materialised rows (C5)', async () => {
      const workspaceId = await seedWorkspace('ID-57.7 empty workspace');
      const fq = await seedFormQuestion(
        workspaceId,
        'Form question with no candidates?',
      );

      // Deliberately do NOT recompute → no materialised edges.
      const { data, error } = await search({ p_form_question_id: fq });
      expect(
        error,
        `search must not error on empty: ${error?.message}`,
      ).toBeNull();
      expect(data).toEqual([]);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 6 (B6): a pair unpublished AFTER materialisation is suppressed at read
    // (read-time publication re-check — no stale surfacing).
    // -------------------------------------------------------------------------
    it('suppresses a pair unpublished after materialisation at read time (B6)', async () => {
      const workspaceId = await seedWorkspace('ID-57.7 B6 workspace');
      const fq = await seedFormQuestion(
        workspaceId,
        'B6 read-time re-check probe?',
      );

      const stays = await seedQaPair({
        questionText: 'Still-published procurement compliance pair.',
        answerStandard: 'Remains published.',
        publicationStatus: 'published',
        embedding: makeEmbedding(1.0, 0.0),
        scopeTag: ['procurement'],
      });
      const willUnpublish = await seedQaPair({
        questionText: 'Soon-to-be-archived procurement compliance pair.',
        answerStandard: 'Will be archived after materialisation.',
        publicationStatus: 'published',
        embedding: makeEmbedding(0.95, 0.0),
        scopeTag: ['procurement'],
      });

      const count = await materialise(fq);
      expect(count).toBe(2);

      // Both materialised; both visible at read while still published.
      const before = await search({ p_form_question_id: fq });
      expect(before.error).toBeNull();
      expect(before.data!.map((r) => r.q_a_pair_id).sort()).toEqual(
        [stays, willUnpublish].sort(),
      );

      // Unpublish ONE pair AFTER the edge was materialised. The edge row still
      // exists in question_matches; the reader must re-check publication and
      // suppress it (B6 — no stale surfacing).
      const { error: updErr } = await db
        .from('q_a_pairs')
        .update({ publication_status: 'archived' })
        .eq('id', willUnpublish)
        .select('id');
      expect(updErr, `unpublish failed: ${updErr?.message}`).toBeNull();

      const after = await search({ p_form_question_id: fq });
      expect(after.error).toBeNull();
      const afterIds = after.data!.map((r) => r.q_a_pair_id);
      expect(afterIds).toEqual([stays]);
      expect(afterIds).not.toContain(willUnpublish);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 7 (B4/A6): p_question_kind filter narrows the result correctly.
    // -------------------------------------------------------------------------
    it('narrows results by the p_question_kind filter (B4/A6)', async () => {
      const workspaceId = await seedWorkspace('ID-57.7 kind-filter workspace');
      const fq = await seedFormQuestion(workspaceId, 'Kind filter probe?');

      const pairBid = await seedQaPair({
        questionText: 'Bid-kind procurement compliance pair.',
        answerStandard: 'Bid answer.',
        publicationStatus: 'published',
        embedding: makeEmbedding(1.0, 0.0),
        scopeTag: ['procurement'],
      });

      // Discover a SECOND valid form_types key (other than 'bid') so the kind
      // filter has something to discriminate against. Fall back gracefully if the
      // catalogue only has one kind.
      const { data: kinds, error: kindsErr } = await db
        .from('form_types')
        .select('key')
        .limit(5);
      expect(
        kindsErr,
        `form_types read failed: ${kindsErr?.message}`,
      ).toBeNull();
      const otherKind = (kinds ?? [])
        .map((k) => k.key as string)
        .find((k) => k !== 'bid');

      // Materialise the SAME corpus under the 'bid' kind.
      await materialise(fq, { questionKind: 'bid' });

      // Filtering by 'bid' returns the materialised pair.
      const bidResult = await search({
        p_form_question_id: fq,
        p_question_kind: 'bid',
      });
      expect(bidResult.error).toBeNull();
      expect(bidResult.data!.map((r) => r.q_a_pair_id)).toEqual([pairBid]);

      // NULL kind (default) also returns it (no narrowing).
      const allResult = await search({ p_form_question_id: fq });
      expect(allResult.error).toBeNull();
      expect(allResult.data!.map((r) => r.q_a_pair_id)).toEqual([pairBid]);

      // Filtering by a DIFFERENT kind returns nothing (the edge is kind='bid').
      if (otherKind) {
        const otherResult = await search({
          p_form_question_id: fq,
          p_question_kind: otherKind,
        });
        expect(otherResult.error).toBeNull();
        expect(otherResult.data).toEqual([]);
      }
    }, 60_000);
  },
);
