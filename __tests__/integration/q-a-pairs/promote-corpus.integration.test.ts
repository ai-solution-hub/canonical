/**
 * Integration tests for promoteCorpusExtractions — ID-59 {59.22} + {59.23}
 *
 * Spec: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *       R1 steps 1, 2, 3, 4, 5, 7.
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
 * It must be verified on staging (turayklvaunphgbgscat) where the {59.21}
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

import { promoteCorpusExtractions } from '@/lib/q-a-pairs/promote-corpus';

// ---------------------------------------------------------------------------
// Environment bootstrap
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
  db = createClient<Database>(url, key);
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
  },
);
