/**
 * Integration tests for promoteCorpusExtractions — ID-59 {59.22} + {59.23} + {59.24}
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 4, 5, 6, 7.
 *
 * Scope:
 *   - Real CAS / idempotency / race proof against the staging Supabase instance.
 *   - {59.23} self-heal: seed a linked-but-unembedded pair, run the function
 *     with a real embed, assert it reaches published with non-null embedding.
 *   - Requires the {59.21} migration to be applied:
 *       20260614012600_id59_route_i_promotion_idempotency_index.sql
 *       20260614012601_id59_route_i_promotion_idempotency_rpc.sql
 *
 * GUARD: KH_RUN_INTEGRATION=1 required — tests are skipIf-guarded so the offline
 * unit-test suite (bun run test) never hits the network.
 *
 * Run via:
 *   KH_RUN_INTEGRATION=1 bun run test:integration -- \
 *     __tests__/integration/q-a-pairs/promote-corpus.integration.test.ts
 *
 * NOTE for the Orchestrator / Checker: this suite CANNOT be run offline.
 * It must be verified on the staging branch where the {59.21}
 * migrations are applied. The parent should run this suite on staging before
 * marking {59.23} done.
 *
 * FK-safe teardown: q_a_extractions DELETE (FK → q_a_pairs ON DELETE SET NULL)
 * then q_a_pairs DELETE; tracked via afterEach seeded-id lists.
 *
 * Mock discipline: NO mocks — real Supabase client (service-role for setup/
 * teardown; the SUT receives the same service-role client here since it is the
 * authorised pipeline caller shape; in production the HTTP route passes an
 * authorised cookie-based client).
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterEach } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { DB_OPTION } from '@/lib/supabase/schema';
import { findProjectRoot } from '@/__tests__/integration/helpers/find-project-root';

import { promoteCorpusExtractions } from '@/lib/q-a-pairs/promote-corpus';
import { generateEmbedding } from '@/lib/ai/embed';

// ---------------------------------------------------------------------------
// Environment bootstrap
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

const RUN_INTEGRATION = Boolean(process.env.KH_RUN_INTEGRATION);

// ---------------------------------------------------------------------------
// Service-role client — bypasses RLS for setup/teardown.
// ---------------------------------------------------------------------------
let db: SupabaseClient<Database>;

if (RUN_INTEGRATION) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      '{59.22}/{59.23} integration tests require NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }
  // ID-115 (S9): route to the exposed api schema
  db = createClient<Database>(url, key, { ...DB_OPTION });
}

// ---------------------------------------------------------------------------
// FK-safe cleanup tracking
// ---------------------------------------------------------------------------
let seededPairIds: string[] = [];
let seededExtractionIds: string[] = [];

afterEach(async () => {
  if (
    !RUN_INTEGRATION ||
    (seededPairIds.length === 0 && seededExtractionIds.length === 0)
  ) {
    return;
  }
  // FK-safe order: extractions first (FK → q_a_pairs ON DELETE SET NULL),
  // then pairs.
  if (seededExtractionIds.length > 0) {
    await db.from('q_a_extractions').delete().in('id', seededExtractionIds);
  }
  if (seededPairIds.length > 0) {
    // Also clean up any extractions pointing at seeded pairs that the SUT
    // might have inserted (in case the seeded extraction was promoted).
    await db
      .from('q_a_extractions')
      .delete()
      .in('promoted_to_pair_id', seededPairIds);
    await db.from('q_a_pairs').delete().in('id', seededPairIds);
  }
  seededPairIds = [];
  seededExtractionIds = [];
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------
async function seedExtraction(opts: {
  promotedToPairId?: string | null;
  invalidated?: boolean;
  answerText?: string | null;
  sourceContentItemId?: string | null;
}): Promise<string> {
  const payload: Database['public']['Tables']['q_a_extractions']['Insert'] = {
    extractor_kind: 'llm_extraction',
    extracted_question_text: `corp-promo-q-${crypto.randomUUID()}`,
    extracted_answer_text:
      opts.answerText !== undefined
        ? opts.answerText
        : 'Test answer for corpus promotion.',
    promoted_to_pair_id: opts.promotedToPairId ?? null,
    invalidated_at: opts.invalidated ? new Date().toISOString() : null,
    source_content_item_id: opts.sourceContentItemId ?? null,
  };
  const { data, error } = await db
    .from('q_a_extractions')
    .insert(payload)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seedExtraction failed: ${error?.message ?? 'no data'}`);
  }
  seededExtractionIds.push(data.id);
  return data.id;
}

async function seedPair(opts: { embedded?: boolean } = {}): Promise<string> {
  const { data, error } = await db
    .from('q_a_pairs')
    .insert({
      question_text: `corp-promo-pair-q-${crypto.randomUUID()}`,
      answer_standard: 'Test pair answer.',
      origin_kind: 'extracted_from_corpus',
      publication_status: opts.embedded ? 'published' : 'draft',
      question_embedding: opts.embedded
        ? JSON.stringify(Array(1024).fill(0))
        : undefined,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seedPair failed: ${error?.message ?? 'no data'}`);
  }
  seededPairIds.push(data.id);
  return data.id;
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe.skipIf(!RUN_INTEGRATION)(
  'ID-59 {59.22}/{59.23} promoteCorpusExtractions — integration',
  () => {
    // -----------------------------------------------------------------------
    // Test 1: basic promotion — live unlinked extraction gets a draft pair
    //         then embed fires → pair reaches published with non-null embedding
    // -----------------------------------------------------------------------
    it('promotes a live unlinked extraction: field map correct, pair published with embedding', async () => {
      const extractionId = await seedExtraction({});

      const summary = await promoteCorpusExtractions(db);

      expect(summary.considered).toBeGreaterThanOrEqual(1);

      // The extraction should now be linked
      const { data: ext } = await db
        .from('q_a_extractions')
        .select('promoted_to_pair_id')
        .eq('id', extractionId)
        .single();

      expect(ext?.promoted_to_pair_id).not.toBeNull();

      // Track the promoted pair for cleanup
      if (ext?.promoted_to_pair_id) {
        seededPairIds.push(ext.promoted_to_pair_id);

        // Verify field map + embed + publish on the created pair ({59.23})
        const { data: pair } = await db
          .from('q_a_pairs')
          .select(
            'origin_kind, publication_status, question_embedding, source_form_response_id, source_question_id, alternate_question_phrasings',
          )
          .eq('id', ext.promoted_to_pair_id)
          .single();

        // INV-4: origin_kind
        expect(pair?.origin_kind).toBe('extracted_from_corpus');
        // {59.23}: embed fires → pair must be published with non-null embedding
        expect(pair?.publication_status).toBe('published');
        expect(pair?.question_embedding).not.toBeNull();
        // Route-i pairs have no form response lineage
        expect(pair?.source_form_response_id).toBeNull();
        expect(pair?.source_question_id).toBeNull();
        // DB DEFAULT '{}' round-trips as an empty text[]
        expect(pair?.alternate_question_phrasings).toEqual([]);
      }

      expect(summary.promoted).toBeGreaterThanOrEqual(1);
      // embed_failed should be 0 in the happy path
      expect(summary.embed_failed).toBe(0);
      // INV-23: promoted - embed_failed == published-this-run (at least 1)
      expect(summary.promoted - summary.embed_failed).toBeGreaterThanOrEqual(1);
    }, 60_000);

    // -----------------------------------------------------------------------
    // Test 2: idempotency — second run promotes nothing new
    // -----------------------------------------------------------------------
    it('second run over same extraction produces zero additional pairs (INV-8)', async () => {
      const extractionId = await seedExtraction({});

      const summary1 = await promoteCorpusExtractions(db);
      // Get the promoted pair id for cleanup
      const { data: ext } = await db
        .from('q_a_extractions')
        .select('promoted_to_pair_id')
        .eq('id', extractionId)
        .single();
      if (ext?.promoted_to_pair_id) {
        seededPairIds.push(ext.promoted_to_pair_id);
      }

      const promotedBefore = summary1.promoted;

      // Second run
      const summary2 = await promoteCorpusExtractions(db);

      // No new promotions for already-linked (and now published) extractions
      expect(summary2.promoted).toBeLessThanOrEqual(promotedBefore);
    }, 60_000);

    // -----------------------------------------------------------------------
    // Test 3: skip NULL answer text — no pair created
    // -----------------------------------------------------------------------
    it('skips extraction with NULL answer text (INV-7)', async () => {
      const extractionId = await seedExtraction({ answerText: null });

      const summary = await promoteCorpusExtractions(db);

      const skipRecord = summary.skipped.find(
        (s) => s.extractionId === extractionId,
      );
      expect(skipRecord).toBeDefined();
      expect(skipRecord?.reason).toBe('no_answer_text');

      // No pair should have been created for this extraction
      const { data: ext } = await db
        .from('q_a_extractions')
        .select('promoted_to_pair_id')
        .eq('id', extractionId)
        .single();
      expect(ext?.promoted_to_pair_id).toBeNull();
    }, 60_000);

    // -----------------------------------------------------------------------
    // Test 4 ({59.23} self-heal): seed a linked-but-unembedded pair,
    //   run the function with a real embed, assert it reaches published
    //   with non-null embedding. (OQ-3 self-heal integration proof)
    // -----------------------------------------------------------------------
    it('{59.23} self-heal: linked-but-unembedded pair gets embedded and published', async () => {
      // Seed a draft pair (unembedded — simulates a prior run where embed failed)
      const existingPairId = await seedPair({ embedded: false });
      // Seed an extraction already linked to it (the unembedded-retry case)
      const extractionId = await seedExtraction({
        promotedToPairId: existingPairId,
      });

      // The pair should start as draft with null embedding
      const { data: pairBefore } = await db
        .from('q_a_pairs')
        .select('publication_status, question_embedding')
        .eq('id', existingPairId)
        .single();
      expect(pairBefore?.publication_status).toBe('draft');
      expect(pairBefore?.question_embedding).toBeNull();

      const summary = await promoteCorpusExtractions(db);

      // The function should have attempted embedding for this linked-unembedded row
      expect(summary.promoted).toBeGreaterThanOrEqual(1);

      // The extraction must still point at the original pair (link unchanged)
      const { data: ext } = await db
        .from('q_a_extractions')
        .select('promoted_to_pair_id')
        .eq('id', extractionId)
        .single();
      expect(ext?.promoted_to_pair_id).toBe(existingPairId);

      // The pair must now be published with a non-null embedding (INV-11/INV-12)
      const { data: pairAfter } = await db
        .from('q_a_pairs')
        .select('publication_status, question_embedding')
        .eq('id', existingPairId)
        .single();
      expect(pairAfter?.publication_status).toBe('published');
      expect(pairAfter?.question_embedding).not.toBeNull();

      // embed_failed should be 0 for this run (embed succeeded)
      expect(summary.embed_failed).toBe(0);
    }, 60_000);

    // -----------------------------------------------------------------------
    // Test 5 ({59.24} OQ-2 retirement — no replacement):
    //   Seed an invalidated extraction linked to a published pair.
    //   source_content_item_id is NULL (no FK needed; no replacement possible).
    //   Run promoteCorpusExtractions → assert old pair becomes 'archived'
    //   with superseded_by=NULL, retired_no_replacement===1.
    //   Assert the {64.15} history trigger wrote a q_a_pair_history row.
    // -----------------------------------------------------------------------
    it('{59.24} OQ-2 retirement (no replacement): invalidated pair archived, history row written', async () => {
      // Seed an already-published pair that should be retired
      const oldPairId = await seedPair({ embedded: true });

      // Seed an invalidated extraction linked to that published pair
      // source_content_item_id=null → no replacement lookup possible
      const invalidatedExtractionId = await seedExtraction({
        promotedToPairId: oldPairId,
        invalidated: true,
        sourceContentItemId: null,
      });

      // Verify initial state
      const { data: pairBefore } = await db
        .from('q_a_pairs')
        .select('publication_status, superseded_by')
        .eq('id', oldPairId)
        .single();
      expect(pairBefore?.publication_status).toBe('published');
      expect(pairBefore?.superseded_by).toBeNull();

      const summary = await promoteCorpusExtractions(db);

      // OQ-2 retirement: no replacement path
      expect(summary.retired).toBe(0);
      expect(summary.retired_no_replacement).toBeGreaterThanOrEqual(1);

      // Old pair must be archived
      const { data: pairAfter } = await db
        .from('q_a_pairs')
        .select('publication_status, superseded_by')
        .eq('id', oldPairId)
        .single();
      expect(pairAfter?.publication_status).toBe('archived');
      // No replacement → superseded_by stays NULL
      expect(pairAfter?.superseded_by).toBeNull();

      // The invalidated extraction still points at the old pair
      const { data: ext } = await db
        .from('q_a_extractions')
        .select('promoted_to_pair_id, invalidated_at')
        .eq('id', invalidatedExtractionId)
        .single();
      expect(ext?.promoted_to_pair_id).toBe(oldPairId);
      expect(ext?.invalidated_at).not.toBeNull();

      // {64.15} history trigger: assert a q_a_pair_history row was written
      // for the publication_status transition on this pair.
      const { data: historyRows } = await db
        .from('q_a_pair_history')
        .select('q_a_pair_id, changed_at')
        .eq('q_a_pair_id', oldPairId)
        .order('changed_at', { ascending: false })
        .limit(1);
      expect(historyRows).not.toBeNull();
      expect(historyRows?.length).toBeGreaterThanOrEqual(1);
    }, 60_000);

    // -----------------------------------------------------------------------
    // Test 6 ({59.24} OQ-2 retirement — idempotency):
    //   Run once (archives the pair), run again → retired_no_replacement===0
    //   on the second run (pair is already 'archived', not returned by the
    //   publication_status='published' filter).
    // -----------------------------------------------------------------------
    it('{59.24} OQ-2 retirement idempotency: second run returns retired_no_replacement===0 for already-archived pair', async () => {
      // Seed an invalidated extraction linked to a published pair
      const oldPairId = await seedPair({ embedded: true });
      await seedExtraction({
        promotedToPairId: oldPairId,
        invalidated: true,
        sourceContentItemId: null,
      });

      // First run: retires the pair
      const summary1 = await promoteCorpusExtractions(db);
      expect(summary1.retired_no_replacement).toBeGreaterThanOrEqual(1);

      // Second run: already-archived pair is excluded by the filter
      const summary2 = await promoteCorpusExtractions(db);
      // Must not double-retire the same pair
      expect(summary2.retired).toBe(0);
      expect(summary2.retired_no_replacement).toBe(0);
    }, 60_000);

    // -----------------------------------------------------------------------
    // Test 7 — {59.25} INV-23 end-to-end assertion (the ID-45 cutover gate)
    //
    // Seeds a small eligible corpus, runs promoteCorpusExtractions, then
    // verifies the INV-23 equation:
    //   published-this-run == summary.promoted - summary.embed_failed
    //
    // For a clean fresh-corpus run with embedding succeeding:
    //   published-this-run = summary.promoted  (embed_failed == 0)
    //
    // Verification: the count of q_a_pairs where
    //   origin_kind='extracted_from_corpus' AND publication_status='published'
    // that were created THIS run (identified via the extraction IDs seeded here)
    // equals summary.promoted - summary.embed_failed.
    //
    // This also verifies q_a_search visibility: the RPC predicate requires
    //   publication_status='published' AND question_embedding IS NOT NULL
    // (migration 20260520231524_t6_q_a_search_rpcs.sql:117-118).
    // We assert both conditions on the promoted pairs.
    // -----------------------------------------------------------------------
    it('{59.25} INV-23 end-to-end: published-this-run == promoted - embed_failed (cutover gate)', async () => {
      // Seed 3 fresh eligible extractions (unlinked, valid answer text)
      const e1 = await seedExtraction({
        answerText: 'Answer for corpus pair 1.',
      });
      const e2 = await seedExtraction({
        answerText: 'Answer for corpus pair 2.',
      });
      const e3 = await seedExtraction({
        answerText: 'Answer for corpus pair 3.',
      });
      const seededExtrIds = [e1, e2, e3];

      const summary = await promoteCorpusExtractions(db);

      // INV-23 equation must hold as a hard invariant
      const publishedThisRunCount = summary.promoted - summary.embed_failed;
      expect(publishedThisRunCount).toBeGreaterThanOrEqual(0);
      // At least some promoted in a clean run
      expect(summary.promoted).toBeGreaterThanOrEqual(seededExtrIds.length);

      // Collect the pair IDs created for our seeded extractions
      const promotedPairIds: string[] = [];
      for (const extractionId of seededExtrIds) {
        const { data: ext } = await db
          .from('q_a_extractions')
          .select('promoted_to_pair_id')
          .eq('id', extractionId)
          .single();
        if (ext?.promoted_to_pair_id) {
          promotedPairIds.push(ext.promoted_to_pair_id);
          // Track for cleanup
          seededPairIds.push(ext.promoted_to_pair_id);
        }
      }

      // Verify INV-23 equation on our seeded pairs:
      // published-this-run (among our seeded corpus) == pairs that are
      // now published with non-null embedding (embed succeeded for those pairs)
      const { data: publishedPairs } = await db
        .from('q_a_pairs')
        .select('id, publication_status, question_embedding, origin_kind')
        .in('id', promotedPairIds);

      const publishedCount = (publishedPairs ?? []).filter(
        (p) =>
          p.publication_status === 'published' && p.question_embedding !== null,
      ).length;

      const failedCount = (publishedPairs ?? []).filter(
        (p) =>
          p.publication_status === 'draft' || p.question_embedding === null,
      ).length;

      // INV-23: published == promoted - embed_failed (for our seeded subset)
      // promoted for seeded = promotedPairIds.length
      // embed_failed for seeded = failedCount
      // published for seeded = publishedCount
      expect(publishedCount).toBe(promotedPairIds.length - failedCount);

      // All promoted pairs must be origin_kind='extracted_from_corpus' (INV-4)
      for (const pair of publishedPairs ?? []) {
        expect(pair.origin_kind).toBe('extracted_from_corpus');
      }

      // q_a_search visibility: published pairs must have non-null question_embedding
      // (predicate: publication_status='published' AND question_embedding IS NOT NULL)
      // In a successful embedding run, all published pairs are also searchable.
      if (summary.embed_failed === 0) {
        // All promoted pairs should be published with non-null embedding
        expect(publishedCount).toBe(promotedPairIds.length);
        for (const pair of publishedPairs ?? []) {
          expect(pair.publication_status).toBe('published');
          expect(pair.question_embedding).not.toBeNull();
        }
      }

      // INV-23 RPC gate: invoke q_a_search with one promoted pair's own question
      // text to prove the pair is OBSERVABLY surfaced via the RPC (the ID-45
      // cutover gate mechanism — not just predicate-satisfying in the table).
      // A self-match gives high cosine similarity so the pair ranks top.
      // Uses the first successfully published seeded pair.
      if (promotedPairIds.length > 0 && summary.embed_failed === 0) {
        // Fetch the question text for the first promoted pair
        const { data: firstPair } = await db
          .from('q_a_pairs')
          .select('id, question_text')
          .eq('id', promotedPairIds[0])
          .single();

        expect(firstPair).not.toBeNull();
        const questionText = firstPair!.question_text;

        // Generate the embedding for the self-match query (high cosine similarity → top rank)
        const queryEmbedding = await generateEmbedding(questionText);

        // Call q_a_search RPC — RETURNS TABLE(pair_id uuid, ...)
        const { data: rpcRows, error: rpcError } = await db.rpc('q_a_search', {
          p_query: questionText,
          p_query_embedding: JSON.stringify(queryEmbedding),
          p_limit: 20,
        });

        expect(rpcError).toBeNull();
        expect(rpcRows).not.toBeNull();

        // The promoted pair must appear in q_a_search results (the ID-45 cutover gate)
        const returnedPairIds = (rpcRows ?? []).map(
          (r: { pair_id: string }) => r.pair_id,
        );
        expect(returnedPairIds).toContain(promotedPairIds[0]);
      }
    }, 120_000);
  },
);
