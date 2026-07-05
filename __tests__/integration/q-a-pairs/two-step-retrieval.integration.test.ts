/**
 * T6 WP3 — Integration tests for q_a_pairs two-step retrieval pattern
 *
 * Scope: PLAN.md §4.6 sub-task 7. Exercises:
 *   1. q_a_search RPC  — two-step Step 1 (ranked preview list with separate
 *      embedding_score + fulltext_score per N9 RESOLVED-S236).
 *   2. q_a_get_verbatim RPC — two-step Step 2 (full row excluding
 *      question_embedding per S16 §6.1 payload-size discipline).
 *   3. q_a_pair_history trigger — AFTER UPDATE fires on every q_a_pairs
 *      UPDATE, captures OLD row, assigns sequential version numbers.
 *   4. CASCADE DELETE — deleting a q_a_pair removes orphan history rows.
 *
 * Sources of truth:
 *   * PLAN.md §4.6 sub-task 7 acceptance criteria
 *   * docs/plans/phase-0-investigation/architecture/05-qa-flow.md §7.2-§7.3
 *     (two-step retrieval contract; separate embedding_score + fulltext_score)
 *   * docs/plans/phase-0-investigation/0.9-spike-S16-qa-schema-design.md §6.1
 *     (list/preview → get/verbatim; question_embedding excluded from verbatim)
 *   * Migration 20260520225456_t6_q_a_pairs_full_schema.sql (table shape)
 *   * Migration 20260520231524_t6_q_a_search_rpcs.sql (RPC signatures)
 *
 * CLAUDE.md gotchas applied:
 *   * Embedding vector: JSON.stringify(embeddingArray) for RPC params, NOT raw array.
 *   * Service-role client: bypasses RLS for test setup/cleanup.
 *   * FK-safe cleanup order: q_a_pair_history DELETE → q_a_extractions DELETE
 *     → q_a_pairs DELETE (CASCADE on history FK handles it automatically when
 *     q_a_pairs is deleted, but explicit first is defensive).
 *   * Hard assertions only — no conditional if-visible patterns.
 *   * KH_RUN_INTEGRATION guard: describe.skipIf so non-integration runs skip.
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
 * FIXED (ID-131.19, S450 GO tail #3): the `q_a_search` SQL function
 * (exercised by the "two-step retrieval Step 1" tests below) used to read
 * `qap.question_embedding` directly in its body (cosine-distance expression +
 * `WHERE qap.question_embedding IS NOT NULL`; squash baseline, never
 * redefined by the {131.11} search redesign), which errored ("column does
 * not exist") once the column was dropped. Re-pointed onto record_embeddings
 * by supabase/migrations/20260706170000_id131_qa_fns_record_embeddings_repoint.sql
 * — AUTHORED, NOT YET APPLIED (owner-gated GO-sequence apply); the
 * q_a_search-dependent tests below pass once that migration lands.
 * `q_a_get_verbatim` (Step 2) has NO question_embedding reference (the whole
 * point of the two-step pattern is that Step 2 excludes the embedding
 * payload) and the `q_a_pair_history`/CASCADE DELETE tests below were never
 * affected. Separate from lib/q-a-pairs/promote-corpus.ts's parallel fix.
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
// Environment bootstrap
// ---------------------------------------------------------------------------
// Walk up from cwd to find project root (same pattern as helpers/service-client.ts).
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
// The entire suite is skipped in CI unless KH_RUN_INTEGRATION=1 is set.
// This prevents accidental live-DB calls from the standard unit test runner.
const RUN_INTEGRATION = Boolean(process.env.KH_RUN_INTEGRATION);

// ---------------------------------------------------------------------------
// Service-role client
// ---------------------------------------------------------------------------
// Service role bypasses RLS — required for test setup/teardown.
// DO NOT use anon client — RLS-PATTERN P-3 blocks q_a_pairs writes for anon.
let db: SupabaseClient<Database>;

if (RUN_INTEGRATION) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'T6 WP3 integration tests require NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }

  // ID-115 (S9): route to the exposed api schema
  db = createClient<Database>(url, key, { ...DB_OPTION });
}

// ---------------------------------------------------------------------------
// Test ID tracking for FK-safe cleanup
// ---------------------------------------------------------------------------
// Tracks q_a_pairs IDs seeded in each test so afterEach can clean up.
// q_a_pair_history and q_a_extractions rows that reference these IDs are
// cleaned first (defensive — CASCADE handles history automatically on pair
// DELETE, but explicit first is belt-and-suspenders per dispatch brief).
let seededPairIds: string[] = [];
// Workspaces seeded for source_workspace_id lineage tests (ID-64.15). Cleaned
// up AFTER q_a_pairs are deleted (q_a_pairs.source_workspace_id FK -> workspaces).
let seededWorkspaceIds: string[] = [];

// ---------------------------------------------------------------------------
// Embedding vector helpers
// ---------------------------------------------------------------------------
// 1024-dim zero vector with distinct first dimensions per canned vector.
// CLAUDE.md gotcha: "JSON.stringify(embedding) for Supabase RPC vector params,
// not raw array" — q_a_search RPC param p_query_embedding must be stringified.
function makeEmbedding(d0: number, d1: number = 0): number[] {
  const vec = Array(1024).fill(0) as number[];
  vec[0] = d0;
  vec[1] = d1;
  return vec;
}

// ---------------------------------------------------------------------------
// Seed helper
// ---------------------------------------------------------------------------
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
  sourceWorkspaceId?: string;
}): Promise<string> {
  const payload: Database['public']['Tables']['q_a_pairs']['Insert'] = {
    question_text: opts.questionText,
    answer_standard: opts.answerStandard,
    publication_status: opts.publicationStatus,
    scope_tag: opts.scopeTag ?? [],
    origin_kind: 'curated_explicit',
    source_workspace_id: opts.sourceWorkspaceId,
  };

  const { data, error } = await db
    .from('q_a_pairs')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Seed q_a_pair failed: ${error?.message ?? 'no data'}`);
  }

  seededPairIds.push(data.id);
  if (opts.embedding) {
    await insertEmbedding(data.id, opts.embedding);
  }
  return data.id;
}

// ---------------------------------------------------------------------------
// Workspace seed helper (ID-64.15 — source_workspace_id lineage tests)
// ---------------------------------------------------------------------------
// q_a_pairs.source_workspace_id is an FK -> workspaces(id). To exercise the
// history-snapshot of that column we need a real workspace row. workspaces.type
// is now an application_type_id FK (S246 WP2b T2), so we look up any existing
// application_type and attach to it. Tracked for FK-safe teardown.
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

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterEach(async () => {
  if (
    !RUN_INTEGRATION ||
    (seededPairIds.length === 0 && seededWorkspaceIds.length === 0)
  ) {
    return;
  }

  // FK-safe cleanup order per dispatch brief:
  // 1. q_a_pair_history (CASCADE from q_a_pairs.id — also explicit here)
  // 2. q_a_extractions (FK to q_a_pairs — explicit, no cascade on pair DELETE)
  // 3. record_embeddings (polymorphic owner, no FK — explicit)
  // 4. q_a_pairs
  // 5. workspaces (last — q_a_pairs.source_workspace_id FK -> workspaces(id),
  //    so pairs must be gone before their referenced workspace can be deleted).

  if (seededPairIds.length > 0) {
    await db.from('q_a_pair_history').delete().in('q_a_pair_id', seededPairIds);

    await db
      .from('q_a_extractions')
      .delete()
      .in('promoted_to_pair_id', seededPairIds);

    await db
      .from('record_embeddings')
      .delete()
      .eq('owner_kind', 'q_a_pair')
      .in('owner_id', seededPairIds);

    await db.from('q_a_pairs').delete().in('id', seededPairIds);
  }

  if (seededWorkspaceIds.length > 0) {
    await db.from('workspaces').delete().in('id', seededWorkspaceIds);
  }

  seededPairIds = [];
  seededWorkspaceIds = [];
});

// ---------------------------------------------------------------------------
// Helper: read a single q_a_pair row (excluding question_embedding — not in
// the standard select; used to verify inserts + updates).
// ---------------------------------------------------------------------------
async function readPair(id: string) {
  const { data, error } = await db
    .from('q_a_pairs')
    .select(
      'id, question_text, answer_standard, publication_status, origin_kind, scope_tag',
    )
    .eq('id', id)
    .single();

  if (error || !data) {
    throw new Error(`readPair(${id}) failed: ${error?.message ?? 'no data'}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Helper: read all history rows for a q_a_pair, ordered by version ASC.
// ---------------------------------------------------------------------------
// ID-64.15: superseded_by + source_workspace_id were added to q_a_pair_history
// by migration 20260609143055. The generated database.types.ts regen for these
// columns rides the {64.8} cutover regen (it is a guarded/CI-owned artefact and
// is intentionally NOT regenerated in this Subtask). Until that lands, the
// strict supabase-js select-string parser cannot resolve the two new columns
// off the stale Row type, so we type this helper's result explicitly and select
// via an untyped client view. The query still runs against the live STAGING DB,
// so the assertions verify real trigger behaviour — only the compile-time Row
// shape is decoupled from the generated types.
interface QaPairHistoryRow {
  id: string;
  q_a_pair_id: string;
  version: number;
  question_text: string;
  answer_standard: string;
  publication_status: string;
  superseded_by: string | null;
  source_workspace_id: string | null;
  changed_at: string;
}

async function readHistory(pairId: string): Promise<QaPairHistoryRow[]> {
  // Cast to the untyped client shape so the select string (which references the
  // not-yet-regenerated columns) is not rejected by the strict type parser.
  const { data, error } = await (db as unknown as SupabaseClient)
    .from('q_a_pair_history')
    .select(
      'id, q_a_pair_id, version, question_text, answer_standard, publication_status, superseded_by, source_workspace_id, changed_at',
    )
    .eq('q_a_pair_id', pairId)
    .order('version', { ascending: true });

  if (error) {
    throw new Error(`readHistory(${pairId}) failed: ${error.message}`);
  }
  return (data ?? []) as QaPairHistoryRow[];
}

// ===========================================================================
// Suite
// ===========================================================================

describe.skipIf(!RUN_INTEGRATION)(
  'T6 WP3 — q_a_pairs two-step retrieval + history trigger',
  () => {
    // We use beforeAll to confirm the service client is connected before
    // running any tests. Failure here surfaces a clear error rather than
    // cryptic assertion failures inside individual tests.
    beforeAll(async () => {
      const { error } = await db.from('q_a_pairs').select('id').limit(1);
      if (error) {
        throw new Error(
          `Staging DB connection check failed: ${error.message}. ` +
            'Ensure NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set ' +
            'and T6 migrations have been applied to staging.',
        );
      }
    });

    // -------------------------------------------------------------------------
    // Test 1: q_a_search returns ranked candidates with separate score columns
    // -------------------------------------------------------------------------
    it('q_a_search returns ranked candidates with separate score columns', async () => {
      // Embed pair #2 (the "target") with d0=1.0 so it is the closest to
      // the query vector (which also has d0=1.0). Pairs #1 and #3 have
      // lower similarity (d0=0.1 and d0=0.2 respectively).
      const embedding1 = makeEmbedding(0.1, 0.0);
      const embedding2 = makeEmbedding(1.0, 0.5); // target — closest to query
      const embedding3 = makeEmbedding(0.2, 0.0);

      const pair1Id = await seedQaPair({
        questionText:
          'What is the recommended approach for ISO 27001 certification?',
        answerStandard:
          'ISO 27001 certification requires a formal ISMS implementation.',
        publicationStatus: 'published',
        embedding: embedding1,
        scopeTag: ['procurement'],
      });

      const pair2Id = await seedQaPair({
        questionText: 'How do we demonstrate GDPR compliance to clients?',
        answerStandard:
          'GDPR compliance requires documented data processing activities and DPA agreements.',
        publicationStatus: 'published',
        embedding: embedding2,
        scopeTag: ['procurement', 'sales'],
      });

      const pair3Id = await seedQaPair({
        questionText: 'What certifications does the organisation hold?',
        answerStandard:
          'The organisation holds Cyber Essentials Plus and ISO 9001.',
        publicationStatus: 'published',
        embedding: embedding3,
        scopeTag: ['procurement'],
      });

      // Query embedding aligned to pair #2 (d0=1.0 matches exactly).
      const queryEmbedding = makeEmbedding(1.0, 0.5);
      const queryText = 'GDPR compliance documentation';

      // FIXED — see module docstring: q_a_search now joins record_embeddings
      // (20260706170000_id131_qa_fns_record_embeddings_repoint.sql, authored,
      // pending owner-gated apply).
      const { data, error } = await db.rpc('q_a_search', {
        p_query: queryText,
        p_query_embedding: JSON.stringify(queryEmbedding), // CLAUDE.md: must stringify
        p_limit: 50, // bl-75 nit2: headroom so the seeded pairs appear despite staging accumulation
      });

      expect(error, `q_a_search RPC failed: ${error?.message}`).toBeNull();
      expect(data).toBeDefined();
      expect(Array.isArray(data)).toBe(true);

      // At least one result returned (pair2 must appear).
      expect(data!.length).toBeGreaterThanOrEqual(1);
      // Limit is respected — should not exceed p_limit (bl-75 nit2: raised to 50).
      expect(data!.length).toBeLessThanOrEqual(50);

      // Each row has BOTH separate score columns (N9 RESOLVED-S236).
      for (const row of data!) {
        // pair_id is present
        expect(row.pair_id, 'each row must have pair_id').toBeDefined();

        // embedding_score: cosine similarity in range [0..1].
        expect(
          typeof row.embedding_score,
          'embedding_score must be a number',
        ).toBe('number');
        expect(
          row.embedding_score,
          `embedding_score ${row.embedding_score} must be >= 0`,
        ).toBeGreaterThanOrEqual(0);
        expect(
          row.embedding_score,
          `embedding_score ${row.embedding_score} must be <= 1`,
        ).toBeLessThanOrEqual(1);

        // fulltext_score: ts_rank is always >= 0.
        expect(
          typeof row.fulltext_score,
          'fulltext_score must be a number',
        ).toBe('number');
        expect(
          row.fulltext_score,
          `fulltext_score ${row.fulltext_score} must be >= 0`,
        ).toBeGreaterThanOrEqual(0);

        // question_embedding is NOT in the preview payload (S16 §6.1 discipline).
        // The RPC returns table columns explicitly; embedding must not appear.
        expect(
          'question_embedding' in row,
          'question_embedding must NOT appear in q_a_search result rows',
        ).toBe(false);

        // Preview columns are present.
        expect(
          row.question_text_preview,
          'question_text_preview must be defined',
        ).toBeDefined();
        expect(
          row.answer_standard_preview,
          'answer_standard_preview must be defined',
        ).toBeDefined();

        // scope_tag and publication_status pass-through (caller-side filter substrate).
        expect(Array.isArray(row.scope_tag), 'scope_tag must be an array').toBe(
          true,
        );
        expect(
          row.publication_status,
          'publication_status must be defined',
        ).toBeDefined();
      }

      // Pair #2 appears in results — ranking quality check.
      // The RPC filters WHERE publication_status='published', so all 3 pairs qualify.
      // Pair #2 has the highest cosine similarity to the query vector.
      const returnedPairIds = data!.map((r) => r.pair_id);
      expect(
        returnedPairIds,
        'pair #2 (closest embedding) must appear in ranked results',
      ).toContain(pair2Id);

      // Pair #1 and #3 are present in DB but pair #2 should rank first.
      // We assert pair #2 appears before pair #1 and pair #3 in the result set.
      const pair2Index = returnedPairIds.indexOf(pair2Id);
      const pair1Index = returnedPairIds.indexOf(pair1Id);
      const pair3Index = returnedPairIds.indexOf(pair3Id);

      // bl-75 nit2: assert the seeded published pairs are PRESENT, rather than
      // silently skipping the rank check when they fall outside the result window
      // (the conditional-false-pass antipattern — §2.1, bl-113 class). All three
      // are seeded `published` with query-aligned synthetic embeddings, so with
      // p_limit=50 they must appear; a miss is a real signal (e.g. staging
      // accumulation), not something to swallow.
      expect(
        returnedPairIds,
        'pair #1 (seeded published) must appear within p_limit=50 results',
      ).toContain(pair1Id);
      expect(
        returnedPairIds,
        'pair #3 (seeded published) must appear within p_limit=50 results',
      ).toContain(pair3Id);
      expect(
        pair2Index,
        'pair #2 must rank higher (lower index) than pair #1',
      ).toBeLessThan(pair1Index);
      expect(
        pair2Index,
        'pair #2 must rank higher (lower index) than pair #3',
      ).toBeLessThan(pair3Index);

      // Verify these pair IDs are NOT from old test data — confirm they
      // were seeded by this test (they're in seededPairIds).
      expect(seededPairIds).toContain(pair1Id);
      expect(seededPairIds).toContain(pair2Id);
      expect(seededPairIds).toContain(pair3Id);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 2: q_a_get_verbatim returns full row excluding embedding
    // -------------------------------------------------------------------------
    it('q_a_get_verbatim returns full row excluding question_embedding', async () => {
      // Insert a published pair.
      const publishedEmbedding = makeEmbedding(0.7, 0.3);
      const publishedId = await seedQaPair({
        questionText:
          'What data retention policies apply to tender documentation?',
        answerStandard:
          'Tender documentation must be retained for 7 years per UK public procurement regulations.',
        publicationStatus: 'published',
        embedding: publishedEmbedding,
        scopeTag: ['procurement'],
      });

      // Insert a draft pair — q_a_get_verbatim has no publication_status filter.
      const draftId = await seedQaPair({
        questionText: 'How do we handle supply chain due diligence?',
        answerStandard:
          'Supply chain due diligence requires Tier 1 supplier assessment and risk register.',
        publicationStatus: 'draft',
        // No embedding on the draft — no record_embeddings row is fine
        // (ID-131.19 M6-adjacent: question_embedding moved off q_a_pairs).
      });

      // --- Verbatim for published pair ---
      const { data: publishedData, error: publishedError } = await db.rpc(
        'q_a_get_verbatim',
        { p_pair_id: publishedId },
      );

      expect(
        publishedError,
        `q_a_get_verbatim(published) failed: ${publishedError?.message}`,
      ).toBeNull();
      expect(
        publishedData,
        'published verbatim data must be defined',
      ).toBeDefined();
      expect(
        publishedData!.length,
        'q_a_get_verbatim must return exactly 1 row',
      ).toBe(1);

      const publishedRow = publishedData![0];

      // Full row columns are present (shape per 05-qa-flow.md §7.2).
      expect(publishedRow.id).toBe(publishedId);
      expect(publishedRow.question_text).toBe(
        'What data retention policies apply to tender documentation?',
      );
      expect(publishedRow.answer_standard).toBe(
        'Tender documentation must be retained for 7 years per UK public procurement regulations.',
      );
      expect(publishedRow.publication_status).toBe('published');
      expect(publishedRow.origin_kind).toBe('curated_explicit');
      expect(Array.isArray(publishedRow.scope_tag)).toBe(true);
      expect(Array.isArray(publishedRow.anti_scope_tag)).toBe(true);
      expect(Array.isArray(publishedRow.alternate_question_phrasings)).toBe(
        true,
      );

      // question_embedding is NOT in the verbatim payload (S16 §6.1 discipline —
      // payload-size discipline: omit embedding from the retrieval response).
      expect(
        'question_embedding' in publishedRow,
        'question_embedding must NOT appear in q_a_get_verbatim result',
      ).toBe(false);

      // Timestamp columns are present.
      expect(publishedRow.created_at).toBeDefined();
      expect(publishedRow.updated_at).toBeDefined();

      // bl-75 nit3: assert PRESENCE (not value) of the nullable columns the
      // q_a_get_verbatim RETURNS-TABLE surfaces (squash-baseline migration), so a
      // future column drop is caught as schema drift. Values may be null.
      expect(
        'answer_advanced' in publishedRow,
        'answer_advanced column must be present in q_a_get_verbatim shape',
      ).toBe(true);
      expect(
        'superseded_by' in publishedRow,
        'superseded_by column must be present in q_a_get_verbatim shape',
      ).toBe(true);
      expect(
        'source_workspace_id' in publishedRow,
        'source_workspace_id column must be present in q_a_get_verbatim shape',
      ).toBe(true);
      expect(
        'valid_from' in publishedRow,
        'valid_from column must be present in q_a_get_verbatim shape',
      ).toBe(true);
      expect(
        'valid_to' in publishedRow,
        'valid_to column must be present in q_a_get_verbatim shape',
      ).toBe(true);

      // --- Verbatim for draft pair (no publication_status filter) ---
      const { data: draftData, error: draftError } = await db.rpc(
        'q_a_get_verbatim',
        { p_pair_id: draftId },
      );

      expect(
        draftError,
        `q_a_get_verbatim(draft) failed: ${draftError?.message}`,
      ).toBeNull();
      expect(draftData, 'draft verbatim data must be defined').toBeDefined();
      expect(
        draftData!.length,
        'q_a_get_verbatim must return exactly 1 row for draft pair',
      ).toBe(1);

      const draftRow = draftData![0];
      expect(draftRow.id).toBe(draftId);
      expect(draftRow.publication_status).toBe('draft');

      // question_embedding also absent on draft row.
      expect(
        'question_embedding' in draftRow,
        'question_embedding must NOT appear in draft verbatim result',
      ).toBe(false);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 3: q_a_pair_history trigger writes version rows on UPDATE
    // -------------------------------------------------------------------------
    it('q_a_pair_history trigger writes version on UPDATE and increments version on subsequent UPDATE', async () => {
      const pairId = await seedQaPair({
        questionText: 'What are our IR35 compliance obligations?',
        answerStandard:
          'IR35 compliance requires off-payroll working rules assessment for contractors.',
        publicationStatus: 'draft',
      });

      // Baseline: no history rows should exist (trigger fires on UPDATE, not INSERT).
      const historyBefore = await readHistory(pairId);
      expect(
        historyBefore.length,
        'no history rows should exist before first UPDATE',
      ).toBe(0);

      // First UPDATE: change answer_standard + publication_status.
      const { error: updateError1 } = await db
        .from('q_a_pairs')
        .update({
          answer_standard:
            'IR35 compliance requires off-payroll working rules assessment. Updated v1.',
          publication_status: 'in_review',
        })
        .eq('id', pairId)
        .select('id'); // .select() prevents HTTP 204 hang (CLAUDE.md sandbox gotcha)

      expect(
        updateError1,
        `First UPDATE failed: ${updateError1?.message}`,
      ).toBeNull();

      // After first UPDATE: exactly 1 history row, version=1, snapshot = OLD values.
      const historyAfterFirst = await readHistory(pairId);
      expect(
        historyAfterFirst.length,
        'exactly 1 history row after first UPDATE',
      ).toBe(1);

      const firstHistoryRow = historyAfterFirst[0];
      expect(firstHistoryRow.version).toBe(1);
      expect(firstHistoryRow.q_a_pair_id).toBe(pairId);

      // Snapshot captures OLD row values (before the update was applied).
      expect(firstHistoryRow.question_text).toBe(
        'What are our IR35 compliance obligations?',
      );
      expect(firstHistoryRow.answer_standard).toBe(
        'IR35 compliance requires off-payroll working rules assessment for contractors.',
      );
      expect(firstHistoryRow.publication_status).toBe('draft');

      // changed_at is set.
      expect(firstHistoryRow.changed_at).toBeDefined();

      // Second UPDATE: change question_text + answer.
      const { error: updateError2 } = await db
        .from('q_a_pairs')
        .update({
          question_text:
            'What are our IR35 compliance obligations as a client?',
          answer_standard:
            'IR35 compliance requires off-payroll working rules assessment. Updated v2.',
          publication_status: 'published',
        })
        .eq('id', pairId)
        .select('id');

      expect(
        updateError2,
        `Second UPDATE failed: ${updateError2?.message}`,
      ).toBeNull();

      // After second UPDATE: 2 history rows, versions 1 and 2.
      const historyAfterSecond = await readHistory(pairId);
      expect(
        historyAfterSecond.length,
        'exactly 2 history rows after second UPDATE',
      ).toBe(2);

      const [v1Row, v2Row] = historyAfterSecond;
      expect(v1Row.version).toBe(1);
      expect(v2Row.version).toBe(2);

      // v2 snapshot captures what the row looked like BEFORE the second UPDATE
      // (i.e. the state set by the first UPDATE).
      expect(v2Row.answer_standard).toBe(
        'IR35 compliance requires off-payroll working rules assessment. Updated v1.',
      );
      expect(v2Row.publication_status).toBe('in_review');

      // Verify the live pair row now reflects the second UPDATE.
      const livePair = await readPair(pairId);
      expect(livePair.answer_standard).toBe(
        'IR35 compliance requires off-payroll working rules assessment. Updated v2.',
      );
      expect(livePair.publication_status).toBe('published');
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 3b (ID-64.15): history trigger snapshots superseded_by +
    // source_workspace_id. Proves (i) both columns exist on q_a_pair_history,
    // and (ii) an UPDATE to a q_a_pairs row carrying both lineage values
    // produces a history row that captures BOTH (snapshot = OLD-row values, so
    // the values must be set on the row, then a SUBSEQUENT update fires the
    // snapshot of that state).
    // -------------------------------------------------------------------------
    it('history trigger snapshots superseded_by + source_workspace_id on UPDATE', async () => {
      // Seed a workspace (source_workspace_id FK target) and a supersession
      // target pair (superseded_by FK target on the live q_a_pairs row).
      const workspaceId = await seedWorkspace(
        'ID-64.15 lineage-snapshot workspace',
      );

      const supersedingPairId = await seedQaPair({
        questionText: 'What is the superseding canonical answer?',
        answerStandard:
          'The newer canonical Q/A pair that supersedes the old one.',
        publicationStatus: 'published',
      });

      // Seed the subject pair WITH source_workspace_id already set at insert.
      const subjectPairId = await seedQaPair({
        questionText: 'What is our data residency policy?',
        answerStandard:
          'Data is held within UK/EU regions per contractual terms.',
        publicationStatus: 'draft',
        sourceWorkspaceId: workspaceId,
      });

      // UPDATE 1: set superseded_by (the live q_a_pairs FK accepts the target
      // pair id). This snapshots the OLD state — at which point superseded_by
      // was still NULL but source_workspace_id was already set.
      const { error: update1Err } = await db
        .from('q_a_pairs')
        .update({
          superseded_by: supersedingPairId,
          publication_status: 'in_review',
        })
        .eq('id', subjectPairId)
        .select('id'); // .select() prevents HTTP 204 hang (CLAUDE.md sandbox gotcha)

      expect(
        update1Err,
        `UPDATE 1 (set superseded_by) failed: ${update1Err?.message}`,
      ).toBeNull();

      const historyAfter1 = await readHistory(subjectPairId);
      expect(
        historyAfter1.length,
        'exactly 1 history row after first UPDATE',
      ).toBe(1);

      const v1 = historyAfter1[0];
      // v1 snapshots OLD state: superseded_by still NULL, source_workspace_id set.
      expect(v1.superseded_by, 'v1 superseded_by is OLD (NULL)').toBeNull();
      expect(
        v1.source_workspace_id,
        'v1 source_workspace_id snapshot equals the seeded workspace id',
      ).toBe(workspaceId);

      // UPDATE 2: change the answer. This snapshots the state set by UPDATE 1,
      // i.e. superseded_by = supersedingPairId AND source_workspace_id = workspace.
      const { error: update2Err } = await db
        .from('q_a_pairs')
        .update({
          answer_standard:
            'Data is held within UK regions only per updated contractual terms.',
        })
        .eq('id', subjectPairId)
        .select('id');

      expect(
        update2Err,
        `UPDATE 2 (post-supersession) failed: ${update2Err?.message}`,
      ).toBeNull();

      const historyAfter2 = await readHistory(subjectPairId);
      expect(
        historyAfter2.length,
        'exactly 2 history rows after second UPDATE',
      ).toBe(2);

      const v2 = historyAfter2[1];
      expect(v2.version).toBe(2);
      // v2 snapshots the post-UPDATE-1 state: BOTH lineage columns carried.
      expect(
        v2.superseded_by,
        'v2 superseded_by snapshot equals the superseding pair id',
      ).toBe(supersedingPairId);
      expect(
        v2.source_workspace_id,
        'v2 source_workspace_id snapshot equals the seeded workspace id',
      ).toBe(workspaceId);
    }, 60_000);

    // -------------------------------------------------------------------------
    // Test 4: CASCADE DELETE removes history rows
    // -------------------------------------------------------------------------
    it('CASCADE DELETE removes q_a_pair_history rows when q_a_pair is deleted', async () => {
      const pairId = await seedQaPair({
        questionText: 'What is our approach to sustainable procurement?',
        answerStandard:
          'Sustainable procurement policy requires supplier ESG assessment.',
        publicationStatus: 'draft',
      });

      // Create a history row by updating.
      const { error: updateErr } = await db
        .from('q_a_pairs')
        .update({ answer_standard: 'Updated answer for cascade test.' })
        .eq('id', pairId)
        .select('id');

      expect(
        updateErr,
        `UPDATE for cascade test failed: ${updateErr?.message}`,
      ).toBeNull();

      // Confirm history row exists.
      const historyBefore = await readHistory(pairId);
      expect(historyBefore.length, 'history row must exist before DELETE').toBe(
        1,
      );

      // Perform the DELETE.
      const { error: deleteErr } = await db
        .from('q_a_pairs')
        .delete()
        .eq('id', pairId)
        .select('id');

      expect(
        deleteErr,
        `DELETE q_a_pair failed: ${deleteErr?.message}`,
      ).toBeNull();

      // Remove from seededPairIds since we deleted it manually — afterEach
      // cleanup would fail silently on a non-existent row, but we clean up
      // explicitly to avoid confusion.
      seededPairIds = seededPairIds.filter((id) => id !== pairId);

      // Assert: no orphan history rows for this pair_id.
      // CASCADE DELETE on q_a_pair_history.q_a_pair_id_fkey handles this
      // automatically — we assert the result, not the mechanism.
      const { data: orphanHistory, error: historyCheckErr } = await db
        .from('q_a_pair_history')
        .select('id')
        .eq('q_a_pair_id', pairId);

      expect(
        historyCheckErr,
        `History orphan check failed: ${historyCheckErr?.message}`,
      ).toBeNull();
      expect(
        orphanHistory?.length,
        'no orphan q_a_pair_history rows must remain after CASCADE DELETE',
      ).toBe(0);
    }, 60_000);
  },
);
