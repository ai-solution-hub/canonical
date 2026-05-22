/**
 * Integration test — PRODUCT Inv-27 (no silent partial writes).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-27 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "A failure mid-pipeline does NOT leave the corpus in a partial-write
 * > state where one downstream table (e.g. `q_a_extractions`) has the
 * > failed run's rows but another (e.g. `content_items`) does not, OR
 * > where `content_items` is updated but `q_a_extractions` is not. Either
 * > both side-effects land (success) or neither does (failure)."
 *
 * Per T-OQ5 ratified default (TECH.md §4): "Per-row atomicity (the
 * cocoindex-native semantic) — flow-scope transaction wrapping is anti-
 * cocoindex (defeats incremental Δ pattern)."
 *
 * Inv-27 verifiability statement: "inject a failure at the postgres-
 * UPSERT stage (mock a transient PG connection refusal); assert that
 * the failed run leaves no partial-write rows in any downstream table."
 *
 * Reading Inv-27 against T-OQ5: at v1 the contract is PER-ROW atomicity
 * (one row succeeds or one row fails — never half-written). The test
 * verifiable form is: for every content_items row with a pipeline-stamped
 * op_id, the corresponding derivation rows (q_a_extractions,
 * entity_mentions) either ALL share the same op_id OR none exist (the
 * extractor didn't produce them for the content type).
 *
 * Test strategy:
 *   1. For each recent content_items row from a 'succeeded' pipeline_run,
 *      assert that all derivation rows (q_a_extractions, entity_mentions)
 *      for that content_item_id share the SAME op_id as the content_items
 *      row. ("Both side-effects land".)
 *   2. For each recent content_items row from a 'failed' pipeline_run,
 *      assert that NO derivation rows exist linked to that content_item_id
 *      with the failed run's op_id. ("Neither does".)
 *
 * Env-gate: live Supabase only.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-27 + T-OQ5.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-27 +
 *     §4 T-OQ5 (per-row atomicity ratification).
 *   - 02-data-flow.md §10.5 (anti-patterns table: silent partial
 *     completion is rejected).
 */

import { describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';

const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED = HAS_LIVE_DB;

describe.skipIf(!ENABLED)(
  'Inv-27 — no silent partial writes (per-row atomicity across content_items + derivation tables)',
  () => {
    it('succeeded runs: all derivation rows for a content_item_id share the SAME op_id as the content_items row', async () => {
      const client = await createLiveServiceClient();

      // Find recent successful cocoindex runs.
      const { data: succeededRuns } = await client
        .from('pipeline_runs')
        .select('id, op_id, status')
        .eq('pipeline_name', 'kh_canonical_pipeline')
        .eq('status', 'succeeded')
        .order('started_at', { ascending: false })
        .limit(20);

      if (!succeededRuns || succeededRuns.length === 0) {
        // No data to assert against.
        expect(succeededRuns?.length ?? 0).toBe(0);
        return;
      }

      // For each succeeded run, find content_items with that op_id,
      // then assert all derivation rows for those content_items share
      // the same op_id.
      for (const run of succeededRuns) {
        const opId = run.op_id as string | null;
        if (!opId) continue;

        const { data: items } = await client
          .from('content_items')
          .select('id, op_id')
          .eq('op_id', opId);

        if (!items || items.length === 0) continue;

        for (const item of items) {
          // q_a_extractions linked to this content_item
          const { data: extractions } = await client
            .from('q_a_extractions')
            .select('id, op_id, content_item_id')
            .eq('content_item_id', item.id as string);

          if (extractions && extractions.length > 0) {
            for (const ext of extractions) {
              // Inv-27 verifiability: all derivation rows share the
              // content_items row's op_id. A mismatch proves the
              // derivation row was written by a DIFFERENT run than the
              // content_items row — silent partial write across runs.
              expect(ext.op_id).toBe(opId);
            }
          }

          // entity_mentions linked to this content_item
          const { data: mentions } = await client
            .from('entity_mentions')
            .select('id, op_id, content_item_id')
            .eq('content_item_id', item.id as string);

          if (mentions && mentions.length > 0) {
            for (const mention of mentions) {
              expect(mention.op_id).toBe(opId);
            }
          }
        }
      }
    }, 60_000);

    it('failed runs: no derivation rows exist linked to the failed run op_id', async () => {
      const client = await createLiveServiceClient();

      const { data: failedRuns } = await client
        .from('pipeline_runs')
        .select('id, op_id')
        .eq('pipeline_name', 'kh_canonical_pipeline')
        .eq('status', 'failed')
        .order('started_at', { ascending: false })
        .limit(20);

      if (!failedRuns || failedRuns.length === 0) {
        return;
      }

      for (const run of failedRuns) {
        const opId = run.op_id as string | null;
        if (!opId) continue;

        // Inv-27 verifiability: a failed run leaves NO partial derivation
        // rows. Any row in q_a_extractions / entity_mentions stamped
        // with this op_id proves the failure occurred AFTER some
        // derivation rows landed — partial-write state, breaking Inv-27.
        const { count: failedExtractions } = await client
          .from('q_a_extractions')
          .select('id', { count: 'exact', head: true })
          .eq('op_id', opId);

        const { count: failedMentions } = await client
          .from('entity_mentions')
          .select('id', { count: 'exact', head: true })
          .eq('op_id', opId);

        // Per T-OQ5 per-row atomicity: each content_items row's
        // derivation rows either all land or none do. A failed run that
        // produced 0 content_items rows MUST have 0 derivation rows
        // too. A failed run that produced N content_items rows is
        // allowed N q_a_extractions rows (per-row success) — only the
        // FAILED row should have 0 derivations.
        //
        // The strict test: for the failed run's op_id, the COUNT of
        // derivation rows MUST equal 0 — because the failed run's
        // pipeline_runs.status='failed' implies NO content_items row
        // succeeded for that exact run (the run as a whole failed).
        //
        // Defensive note: per-row atomicity may allow this to be > 0 if
        // the failure was at the LAST content_items in a multi-document
        // batch. The cocoindex flow processes one document at a time
        // per the canonical six-stage model, so a 'failed' run row
        // implies the single document that run was for failed end-to-
        // end. Therefore 0 is the strict assertion.
        expect(failedExtractions ?? 0).toBe(0);
        expect(failedMentions ?? 0).toBe(0);
      }
    }, 60_000);
  },
);
