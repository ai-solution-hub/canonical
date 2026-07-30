/**
 * Integration test — ID-70 `merge_entities` typed-TABLE return + DML atomicity.
 *
 * ID-70 migrated `merge_entities` from `RETURNS jsonb` to
 * `RETURNS TABLE(merged boolean, target text, entity_type text,
 *  mentions_updated integer, relationship_sources_updated integer,
 *  relationship_targets_updated integer, duplicates_removed integer)`
 * (migration 20260623130000_id70_opaque_json_rpc_typed_returns.sql). The
 * function stays LANGUAGE plpgsql (volatile): it performs three UPDATEs
 * (entity_mentions canonical/override repoint, entity_relationships source +
 * target repoint) and a dedup DELETE keeping the highest-confidence row per
 * (canonical_name, COALESCE(entity_type_override, entity_type),
 * source_document_id). PostgREST surfaces a SETOF/TABLE return as an array, so
 * callers read the single summary row as `data[0]`.
 *
 * This test proves, against a real DB, that:
 *   1. The RPC returns ONE typed row whose `merged`/`target`/`entity_type`
 *      echo the inputs.
 *   2. The four count columns equal the ACTUAL row deltas of a controlled
 *      fixture (computed below from the seed).
 *   3. The post-call DB state agrees with those counts — source mentions now
 *      carry the target canonical_name, relationships are repointed, and the
 *      duplicate row is gone. The counts AGREEING with the real row deltas is
 *      what proves the UPDATE×3 + DELETE ran atomically inside the RPC.
 *
 * id-405 extends the same fixture onto `pin_entity_mentions` (migration
 * 20260730150743), the curation-pin RPC the merge route calls next: its return
 * value is what the route reports as `mentions_pinned`, so it must equal the
 * rows actually carrying `metadata.curation_pinned` afterwards. This fixture is
 * the sharp case — the survivors' RAW entity_type stays 'organisation'/
 * 'certification' while the merged type is 'framework', so a pin predicate on
 * the base column matches nothing at all.
 *
 * Fixture (single synthetic source_documents parent per group — ID-131
 * migration 20260628200000_id131_extract_reparent.sql added
 * entity_mentions_source_document_id_fkey onto source_documents, so CI_1/CI_2
 * parent rows are seeded below before the entity_mentions insert):
 *   - mention SRC_A #1: canonical SRC_A, raw type 'organisation',  CI #1
 *   - mention SRC_A #2: canonical SRC_A, raw type 'certification', CI #1
 *       (different RAW type avoids the (canonical_name, entity_type,
 *        source_document_id) UNIQUE seed clash; post-merge BOTH collapse to
 *        (target, override, CI #1) → one is deduped away)
 *   - mention SRC_B:    canonical SRC_B, raw type 'organisation',  CI #2
 *       (distinct content_item → survives dedup)
 *   - relationship REL_S: source_entity = SRC_A   (repointed to target)
 *   - relationship REL_T: target_entity = SRC_B   (repointed to target)
 *
 * Expected deltas for p_source_names = [SRC_A, SRC_B], p_target_name = TARGET:
 *   mentions_updated             = 3  (all three mentions match)
 *   relationship_sources_updated = 1  (REL_S)
 *   relationship_targets_updated = 1  (REL_T)
 *   duplicates_removed           = 1  (the two CI #1 mentions collapse → 1 gone)
 *
 * Env-gate: real live Supabase service credentials (skip-clean when unwired).
 * This runs against the prod-acting Platform DB, so every seeded row carries a
 * unique test-scoped token in its names and cleanup runs in afterAll even on
 * assertion failure — the DB is left exactly as found.
 *
 * References:
 *   - supabase/migrations/20260623130000_id70_opaque_json_rpc_typed_returns.sql
 *     (§3 merge_entities — typed TABLE return).
 *   - app/api/entities/merge/route.ts (the production caller of the RPC).
 *   - __tests__/integration/cocoindex/admin-merge-coexistence.integration.test.ts
 *     (env-gating + service-client + seed/cleanup idiom this test follows).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';

const ENABLED = hasRealLiveDbCredentials();

// Unique, clearly test-scoped token so seeded rows never collide with real
// data and cleanup can target them exactly.
const TOKEN = `__id70_it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}__`;
const SRC_A = `${TOKEN}src_a`;
const SRC_B = `${TOKEN}src_b`;
const TARGET = `${TOKEN}target`;
const MERGED_TYPE = 'framework';

// All canonical_name values this test ever writes (seed sources + merge target)
// — the cleanup deletes every entity_mentions / entity_relationships row whose
// name is in this set, so a partial-merge failure still leaves nothing behind.
const ALL_NAMES = [SRC_A, SRC_B, TARGET];

// Two synthetic source_documents parent ids. Since ID-131
// (20260628200000_id131_extract_reparent.sql) entity_mentions.source_document_id
// carries entity_mentions_source_document_id_fkey → source_documents(id), so
// each of these needs a real parent row (seeded in the test body below).
const CI_1 = crypto.randomUUID();
const CI_2 = crypto.randomUUID();

async function cleanup(): Promise<void> {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  // Delete by every name the test could have written, on BOTH the source and
  // target sides, so cleanup is exhaustive regardless of how far the merge got.
  await client.from('entity_mentions').delete().in('canonical_name', ALL_NAMES);
  await client
    .from('entity_relationships')
    .delete()
    .in('source_entity', ALL_NAMES);
  await client
    .from('entity_relationships')
    .delete()
    .in('target_entity', ALL_NAMES);
  // Parent source_documents rows seeded for the entity_mentions FK (ID-131).
  // ON DELETE CASCADE would also sweep any remaining entity_mentions, but the
  // canonical_name delete above already handles that path.
  await client.from('source_documents').delete().in('id', [CI_1, CI_2]);
}

afterAll(async () => {
  await cleanup();
}, 30_000);

describe.skipIf(!ENABLED)(
  'merge_entities (ID-70) — typed TABLE return reflects the real DML deltas',
  () => {
    it('returns one typed summary row whose counts match the merged/deduped/repointed rows', async () => {
      const client = await createLiveServiceClient();

      // Defensive pre-clean in case a prior aborted run left rows under this
      // token (Date.now()-seeded so collision is near-impossible, but cheap).
      await cleanup();

      // ---- Seed the fixture --------------------------------------------
      // Parent source_documents rows for CI_1/CI_2 — required by
      // entity_mentions_source_document_id_fkey (ID-131,
      // 20260628200000_id131_extract_reparent.sql) before the entity_mentions
      // insert below can succeed.
      const { error: sdErr } = await client.from('source_documents').insert([
        {
          id: CI_1,
          filename: `${TOKEN}-ci-1`,
          mime_type: 'text/plain',
          file_size: 1,
          content_hash: `${TOKEN}-ci-1`,
          storage_path: `test-fixtures/${TOKEN}/ci-1.txt`,
        },
        {
          id: CI_2,
          filename: `${TOKEN}-ci-2`,
          mime_type: 'text/plain',
          file_size: 1,
          content_hash: `${TOKEN}-ci-2`,
          storage_path: `test-fixtures/${TOKEN}/ci-2.txt`,
        },
      ]);
      expect(sdErr).toBeNull();

      const { error: mErr } = await client.from('entity_mentions').insert([
        {
          source_document_id: CI_1,
          canonical_name: SRC_A,
          entity_name: SRC_A,
          entity_type: 'organisation',
          confidence: 0.9,
        },
        {
          source_document_id: CI_1,
          canonical_name: SRC_A,
          entity_name: SRC_A,
          entity_type: 'certification',
          confidence: 0.7,
        },
        {
          source_document_id: CI_2,
          canonical_name: SRC_B,
          entity_name: SRC_B,
          entity_type: 'organisation',
          confidence: 0.8,
        },
      ]);
      expect(mErr).toBeNull();

      const { error: rErr } = await client.from('entity_relationships').insert([
        {
          source_entity: SRC_A,
          target_entity: `${TOKEN}unrelated_target`,
          relationship_type: 'references',
        },
        {
          source_entity: `${TOKEN}unrelated_source`,
          target_entity: SRC_B,
          relationship_type: 'references',
        },
      ]);
      expect(rErr).toBeNull();

      // ---- Call the migrated RPC ---------------------------------------
      const { data, error } = await client.rpc('merge_entities', {
        p_source_names: [SRC_A, SRC_B],
        p_target_name: TARGET,
        p_entity_type: MERGED_TYPE,
      });
      expect(error).toBeNull();

      // PostgREST returns a TABLE/SETOF result as an array; the RPC emits a
      // single summary row, so callers read data[0].
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      const row = data![0]!;

      // Typed-column echoes of the inputs.
      expect(row.merged).toBe(true);
      expect(row.target).toBe(TARGET);
      expect(row.entity_type).toBe(MERGED_TYPE);

      // Counts equal the deltas computed from the seed above.
      expect(row.mentions_updated).toBe(3);
      expect(row.relationship_sources_updated).toBe(1);
      expect(row.relationship_targets_updated).toBe(1);
      expect(row.duplicates_removed).toBe(1);

      // ---- Post-call DB state agrees with the typed counts -------------
      // Source canonical names no longer exist; the target carries the
      // surviving (deduped) mentions: one per content_item → 2 rows.
      const { data: remaining, error: remErr } = await client
        .from('entity_mentions')
        .select('canonical_name, entity_type_override, source_document_id')
        .in('canonical_name', ALL_NAMES);
      expect(remErr).toBeNull();
      expect(remaining).not.toBeNull();
      expect(remaining!.every((m) => m.canonical_name === TARGET)).toBe(true);
      // 3 updated − 1 deduped = 2 surviving mentions under the target.
      expect(remaining!).toHaveLength(2);
      // The merged rows carry the requested type override.
      expect(
        remaining!.every((m) => m.entity_type_override === MERGED_TYPE),
      ).toBe(true);
      // Survivors span both content_items (the CI #1 collapse kept exactly one).
      const survivingCis = new Set(remaining!.map((m) => m.source_document_id));
      expect(survivingCis).toEqual(new Set([CI_1, CI_2]));

      // Relationships are repointed onto the target on both sides.
      const { data: repointed, error: relReadErr } = await client
        .from('entity_relationships')
        .select('source_entity, target_entity')
        .or(`source_entity.eq.${TARGET},target_entity.eq.${TARGET}`);
      expect(relReadErr).toBeNull();
      expect(repointed).not.toBeNull();
      expect(repointed!.some((r) => r.source_entity === TARGET)).toBe(true);
      expect(repointed!.some((r) => r.target_entity === TARGET)).toBe(true);
      // Neither source name survives on the relationship rows.
      expect(repointed!.some((r) => r.source_entity === SRC_A)).toBe(false);
      expect(repointed!.some((r) => r.target_entity === SRC_B)).toBe(false);

      // ---- id-405: the curation pin over the same merge winner -----------
      // The merge route stamps `metadata.curation_pinned` on the survivors so a
      // later ingestion walk cannot revert this merge (id-400 Inv-9). The count
      // the RPC returns is what the route reports as `mentions_pinned`, so it
      // has to equal the rows that are actually pinned in the DB.
      //
      // This fixture is precisely the case the old per-row loop got wrong: the
      // survivors' RAW entity_type is still 'organisation'/'certification'
      // (merge_entities writes entity_type_override and never rewrites the base
      // column), so matching the base column against the merged type 'framework'
      // pins ZERO of the 2 survivors while reporting success.
      const { data: pinned, error: pinErr } = await client.rpc(
        'pin_entity_mentions',
        { p_canonical_name: TARGET, p_entity_type: MERGED_TYPE },
      );
      expect(pinErr).toBeNull();
      expect(pinned).toBe(2);

      const { data: pinnedRows, error: pinReadErr } = await client
        .from('entity_mentions')
        .select('id, entity_type, metadata')
        .eq('canonical_name', TARGET);
      expect(pinReadErr).toBeNull();
      // Every surviving row carries the marker — the returned count is not an
      // estimate over a partially-written set.
      expect(pinnedRows!).toHaveLength(2);
      expect(
        pinnedRows!.every(
          (m) =>
            (m.metadata as Record<string, unknown> | null)?.curation_pinned ===
            true,
        ),
      ).toBe(true);
      // ...and their RAW type never matched the merged type, which is what
      // makes this fixture the regression guard it is.
      expect(pinnedRows!.some((m) => m.entity_type === MERGED_TYPE)).toBe(
        false,
      );
    }, 120_000);

    it('pins nothing, and says so, for a pair that does not exist', async () => {
      // The honest-zero case the route must distinguish from a failed pin: a
      // clean 0 with NO error, not an exception.
      const client = await createLiveServiceClient();
      const { data: pinned, error } = await client.rpc('pin_entity_mentions', {
        p_canonical_name: `${TOKEN}absent`,
        p_entity_type: MERGED_TYPE,
      });
      expect(error).toBeNull();
      expect(pinned).toBe(0);
    }, 30_000);

    it('raises rather than silently pinning nothing on a degenerate pair', async () => {
      // An empty canonical name would match no rows and look identical to an
      // honest zero, so the RPC fails loud instead (mirrors merge_entities'
      // input validation). The route surfaces this as `mentions_pin_error`.
      const client = await createLiveServiceClient();
      const { data: pinned, error } = await client.rpc('pin_entity_mentions', {
        p_canonical_name: '',
        p_entity_type: MERGED_TYPE,
      });
      expect(error).not.toBeNull();
      expect(error!.message).toContain('Canonical name must not be empty');
      expect(pinned).toBeNull();
    }, 30_000);
  },
);
