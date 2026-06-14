/**
 * ID-59 {59.21} M1 — route-i promotion idempotency migration integration tests.
 *
 * Scope: specs/id-59-concurrent-edit-intent-arbitration/TECH-qa-corpus-promotion.md
 *        M1 (UNIQUE partial index + eligibility RPC). Exercises the two DB
 *        objects shipped by:
 *   * 20260614012600_id59_route_i_promotion_idempotency_index.sql
 *       — CREATE UNIQUE INDEX CONCURRENTLY uq_q_a_extractions_promoted_to_pair_id
 *         (WHERE promoted_to_pair_id IS NOT NULL)
 *   * 20260614012601_id59_route_i_promotion_idempotency_rpc.sql
 *       — q_a_extractions_promotion_candidates() (SECURITY INVOKER,
 *         REVOKE EXECUTE FROM anon)
 *
 * testStrategy (subtask {59.21}):
 *   1. UNIQUE index REJECTS a 2nd extraction whose promoted_to_pair_id points at
 *      an already-linked pair id (constraint violation).
 *   2. RPC returns live-unlinked + linked-but-unembedded rows and EXCLUDES
 *      invalidated rows.
 *   3. anon cannot EXECUTE the RPC (RLS-PATTERN P-4 REVOKE).
 *
 * CLAUDE.md gotchas applied:
 *   * Service-role client bypasses RLS for setup/teardown.
 *   * FK-safe cleanup order: q_a_extractions DELETE -> q_a_pairs DELETE.
 *   * Hard assertions only — no conditional if-visible patterns.
 *   * KH_RUN_INTEGRATION guard: describe.skipIf so non-integration runs skip.
 *
 * Run via:
 *   KH_RUN_INTEGRATION=1 bun run test:integration -- \
 *     __tests__/integration/q-a-pairs/promotion-idempotency.integration.test.ts
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterEach } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ---------------------------------------------------------------------------
// Environment bootstrap (same walk-up pattern as the sibling suite).
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
      '{59.21} integration tests require NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }
  db = createClient<Database>(url, key);
}

// ---------------------------------------------------------------------------
// Anon client — carries no JWT, so it acts as the `anon` role. Used to assert
// the REVOKE EXECUTE FROM anon on the eligibility RPC.
// ---------------------------------------------------------------------------
function createAnonClient(): SupabaseClient<Database> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) return null;
  return createClient<Database>(url, anonKey);
}

// ---------------------------------------------------------------------------
// FK-safe cleanup tracking.
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
  // q_a_extractions first (FK -> q_a_pairs, ON DELETE SET NULL — but delete the
  // rows we made), then q_a_pairs.
  if (seededExtractionIds.length > 0) {
    await db.from('q_a_extractions').delete().in('id', seededExtractionIds);
  }
  if (seededPairIds.length > 0) {
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
// Seed helpers.
// ---------------------------------------------------------------------------
function makeEmbedding(d0: number): number[] {
  const vec = Array(1024).fill(0) as number[];
  vec[0] = d0;
  return vec;
}

async function seedPair(opts: { embedded: boolean }): Promise<string> {
  const payload: Database['public']['Tables']['q_a_pairs']['Insert'] = {
    question_text: `idem-q-${crypto.randomUUID()}`,
    answer_standard: 'idem-answer',
    publication_status: opts.embedded ? 'published' : 'draft',
    question_embedding: opts.embedded
      ? JSON.stringify(makeEmbedding(0.5))
      : undefined,
    origin_kind: 'extracted_from_corpus',
  };
  const { data, error } = await db
    .from('q_a_pairs')
    .insert(payload)
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`seedPair failed: ${error?.message ?? 'no data'}`);
  }
  seededPairIds.push(data.id);
  return data.id;
}

async function seedExtraction(opts: {
  promotedToPairId?: string | null;
  invalidated?: boolean;
}): Promise<string> {
  const payload: Database['public']['Tables']['q_a_extractions']['Insert'] = {
    extractor_kind: 'llm_extraction',
    extracted_question_text: `idem-eq-${crypto.randomUUID()}`,
    extracted_answer_text: 'idem-extracted-answer',
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

describe.skipIf(!RUN_INTEGRATION)(
  'ID-59 {59.21} M1 — promotion idempotency',
  () => {
    // -------------------------------------------------------------------------
    // testStrategy 1 — UNIQUE partial index rejects a 2nd extraction linking to
    // an already-linked pair id.
    // -------------------------------------------------------------------------
    it('UNIQUE index rejects a 2nd extraction linking to an already-linked pair', async () => {
      const pairId = await seedPair({ embedded: true });

      // First extraction links to the pair — succeeds.
      await seedExtraction({ promotedToPairId: pairId });

      // Second extraction linking to the SAME pair id must violate the UNIQUE
      // partial index uq_q_a_extractions_promoted_to_pair_id.
      const { error } = await db.from('q_a_extractions').insert({
        extractor_kind: 'llm_extraction',
        extracted_question_text: `idem-dup-${crypto.randomUUID()}`,
        extracted_answer_text: 'dup',
        promoted_to_pair_id: pairId,
      });

      expect(
        error,
        'second extraction linking to an already-linked pair must be rejected by the UNIQUE index',
      ).not.toBeNull();
      // Postgres unique_violation is SQLSTATE 23505.
      expect(error?.code).toBe('23505');
    }, 60_000);

    it('the partial index still allows many unlinked (NULL) extractions', async () => {
      // WHERE promoted_to_pair_id IS NOT NULL — NULL links are NOT constrained.
      await seedExtraction({ promotedToPairId: null });
      const { error } = await db.from('q_a_extractions').insert({
        extractor_kind: 'llm_extraction',
        extracted_question_text: `idem-null2-${crypto.randomUUID()}`,
        extracted_answer_text: 'null2',
        promoted_to_pair_id: null,
      });
      // Track for cleanup if it inserted.
      expect(
        error,
        'two unlinked (NULL promoted_to_pair_id) extractions must both be allowed',
      ).toBeNull();
      // Best-effort cleanup of the second NULL row (no id captured by seed helper).
      await db
        .from('q_a_extractions')
        .delete()
        .like('extracted_question_text', 'idem-null2-%');
    }, 60_000);

    // -------------------------------------------------------------------------
    // testStrategy 2 — eligibility RPC returns live-unlinked + linked-but-unembedded,
    // excludes invalidated.
    // -------------------------------------------------------------------------
    it('eligibility RPC returns live-unlinked + linked-but-unembedded, excludes invalidated', async () => {
      // (a) live + unlinked -> ELIGIBLE
      const unlinkedId = await seedExtraction({ promotedToPairId: null });

      // (b) live + linked-but-its-pair-unembedded -> ELIGIBLE
      const unembeddedPairId = await seedPair({ embedded: false });
      const linkedUnembeddedId = await seedExtraction({
        promotedToPairId: unembeddedPairId,
      });

      // (c) live + linked-but-pair-IS-embedded -> NOT eligible (already done)
      const embeddedPairId = await seedPair({ embedded: true });
      const linkedEmbeddedId = await seedExtraction({
        promotedToPairId: embeddedPairId,
      });

      // (d) invalidated + unlinked -> NOT eligible (excluded by invalidated_at)
      const invalidatedId = await seedExtraction({
        promotedToPairId: null,
        invalidated: true,
      });

      const { data, error } = await db.rpc(
        'q_a_extractions_promotion_candidates',
      );
      expect(error, `RPC call failed: ${error?.message}`).toBeNull();
      expect(data).not.toBeNull();

      const returnedIds = new Set((data ?? []).map((r) => r.id));

      expect(
        returnedIds.has(unlinkedId),
        'live-unlinked must be eligible',
      ).toBe(true);
      expect(
        returnedIds.has(linkedUnembeddedId),
        'linked-but-unembedded must be eligible (OQ-3 self-heal)',
      ).toBe(true);
      expect(
        returnedIds.has(linkedEmbeddedId),
        'linked-AND-embedded must NOT be eligible',
      ).toBe(false);
      expect(
        returnedIds.has(invalidatedId),
        'invalidated rows must be excluded',
      ).toBe(false);
    }, 60_000);

    // -------------------------------------------------------------------------
    // testStrategy 3 — anon cannot EXECUTE the RPC.
    // -------------------------------------------------------------------------
    it('anon cannot EXECUTE q_a_extractions_promotion_candidates', async () => {
      const anon = createAnonClient();
      expect(
        anon,
        'anon client requires NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
      ).not.toBeNull();

      const { error } = await anon!.rpc('q_a_extractions_promotion_candidates');
      expect(
        error,
        'anon EXECUTE on the eligibility RPC must be denied (RLS-PATTERN P-4 REVOKE)',
      ).not.toBeNull();
    }, 60_000);
  },
);
