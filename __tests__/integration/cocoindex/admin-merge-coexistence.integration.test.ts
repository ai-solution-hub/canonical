/**
 * Integration test — PRODUCT Inv-9 (Stage-5 ↔ Admin entity-curation coexistence).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-9 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-9 + TECH §P-11):
 *
 * > "Admin merge/split/type-override/metadata-edit operate on rows from
 * > arbitrary HISTORICAL runs. Stage-5's op_id scoping (Inv-5) ensures a row
 * > admin-merged on a prior run (older op_id) is NEVER overwritten by a later
 * > Stage-5 pass on a different run. Verifiable: an admin merge on rows from
 * > op_id = A is NEVER reverted by a subsequent run op_id = B."
 *
 * Test strategy:
 *   1. Complete run A (pipeline corpus); capture op_id A + a row to "merge".
 *   2. Apply the admin-merge effect — UPDATE the run-A row's canonical_name to
 *      a distinctive admin value AND stamp the curation pin, which is what the
 *      merge route does. The op_id stays A (admin curation does not re-stamp).
 *   3. Stage run B (a NEW corpus) and let its Stage-5 pass complete.
 *   4. Re-read the admin-merged run-A row; assert its canonical_name is STILL
 *      the admin value — the later walk did not revert it.
 *
 * ## Why step 2 stamps the pin (the fix this docblock records)
 *
 * The strategy above used to stop at the bare `canonical_name` UPDATE, calling
 * that "the merge_entities RPC's net effect". It is not: `merge_entities`
 * commits the canonical change, and then `/api/entities/merge` stamps the
 * surviving rows via `pin_entity_mentions` (`route.ts:88-115`, id-405 migration
 * `20260730150743`). The pin is the mechanism the pipeline honours —
 * `flow.py:2929` carries pinned mentions forward on re-ingest and `stage_5.py:117`
 * excludes them from the write-back domain, both filtering on
 * `(metadata->>'curation_pinned') = 'true'`.
 *
 * So the old simulation was the merge MINUS its protection, and it reproduced
 * precisely the symptom the merge route's own comment says the pin closes:
 * "census #41 failure #1 (admin merge reverted on a later walk)". The invariant's
 * original op_id-scoping rationale (below) predates the pin — this test was
 * written at S277 and the pin landed at id-400/id-405. An admin-merged row in
 * the current system IS a pinned row, so a faithful simulation stamps it.
 *
 * Inv-9's original rationale, kept for provenance:
 * > "Stage-5's op_id scoping (Inv-5) ensures a row admin-merged on a prior run
 * > (older op_id) is NEVER overwritten by a later Stage-5 pass on a different
 * > run."
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-9.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-11, §3.
 *   - app/api/entities/merge/route.ts:88-115 (merge_entities + the pin stamp).
 *   - scripts/cocoindex_pipeline/flow.py:2904 / stage_5.py:117 (the pin's honourers).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import { WALK_BUDGET_MS } from './_helpers/walk';
import { pollEntityMentionsFor, UUID_V4_REGEX } from './test-helpers';

// PLANE MISMATCH — id-415's work list (measured by id-412, S524).
// This file asserts entity_mentions admin-merge pinning — plane 1, the cocoindex walk — but stages a
// blank extraction FORM, which is a plane-2 input with no prose to extract.
// All 16 CSP-staging tests measured the same way; none exercise form-field
// extraction. id-412 repoints the PATH only (its Surfaces line reserves
// assertions for id-415); flipping this to a CONTENT fixture changes what the
// body observes, so the fixture swap and the assertion repair land together
// in id-415. Candidate: CONTENT.sectorSpendXlsx (same MIME, real content).
import { FORM_TEMPLATE } from './_helpers/fixtures';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const RUN_A_PREFIX = `[53.14-INV09-A-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const RUN_B_PREFIX = `[53.14-INV09-B-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const ADMIN_CANONICAL = `${RUN_A_PREFIX}-admin-merged-canonical`;
const seededContentIds: string[] = [];
let mergedRowId: string | null = null;
let opIdA: string | null = null;

const POLL_TIMEOUT_MS = 120_000;

const FIXTURE_PATH = FORM_TEMPLATE.cspChecklistXlsx;

beforeAll(async () => {
  if (!ENABLED) return;
  await stageFixture({
    fixturePath: FIXTURE_PATH,
    destPath: `inv-9/${RUN_A_PREFIX}.xlsx`,
    titlePrefix: RUN_A_PREFIX,
  });
}, WALK_BUDGET_MS + 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({
    titlePrefix: RUN_A_PREFIX,
    contentIds: seededContentIds,
  });
  await dropFixture({
    titlePrefix: RUN_B_PREFIX,
    contentIds: seededContentIds,
  });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-9 — Stage-5 never reverts an admin-merged row from a prior run',
  () => {
    it(
      'an admin-merged run-A row retains its admin canonical_name after run B',
      async () => {
        // Run A lands.
        const itemsA = await pollContentItemsFor(RUN_A_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of itemsA) seededContentIds.push(r.id);
        opIdA = itemsA.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opIdA).not.toBeNull();
        expect(opIdA!).toMatch(UUID_V4_REGEX);

        const runAMentions = await pollEntityMentionsFor({
          opId: opIdA!,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(runAMentions.length).toBeGreaterThan(0);

        // Apply the admin-merge effect on a run-A row, BOTH halves of it:
        // (1) merge_entities' canonical UPDATE, then (2) the curation pin the
        // merge route stamps immediately after. op_id stays A — admin curation
        // does not re-stamp op_id. See the docblock for why (2) is not optional.
        const client = await createLiveServiceClient();
        const mergedRow = runAMentions[0]!;
        mergedRowId = mergedRow.id;
        const { error: mergeErr } = await client
          .from('entity_mentions')
          .update({ canonical_name: ADMIN_CANONICAL })
          .eq('id', mergedRowId);
        expect(mergeErr).toBeNull();

        // The same RPC `/api/entities/merge` calls, with the same arguments —
        // matched on the EFFECTIVE type, which is what merge_entities writes.
        const { data: pinnedCount, error: pinErr } = await client.rpc(
          'pin_entity_mentions',
          {
            p_canonical_name: ADMIN_CANONICAL,
            p_entity_type: mergedRow.entity_type,
          },
        );
        expect(pinErr).toBeNull();
        // An unpinned survivor is the census #41 symptom itself, so a zero here
        // means the test is no longer testing what it claims.
        expect(pinnedCount).toBeGreaterThanOrEqual(1);

        // Run B: a NEW corpus; its Stage-5 pass (op_id B) runs to completion.
        await stageFixture({
          fixturePath: FIXTURE_PATH,
          destPath: `inv-9/${RUN_B_PREFIX}.xlsx`,
          titlePrefix: RUN_B_PREFIX,
        });
        const itemsB = await pollContentItemsFor(RUN_B_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of itemsB) seededContentIds.push(r.id);
        const opIdB = itemsB.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opIdB).not.toBeNull();
        expect(opIdB).not.toBe(opIdA);
        await pollEntityMentionsFor({
          opId: opIdB!,
          timeoutMs: POLL_TIMEOUT_MS,
        });

        // Inv-9 verifiability: the admin-merged run-A row STILL carries the
        // admin canonical_name — run B's Stage-5 did not revert it (op_id B
        // never matches the row's op_id A).
        const { data: row, error } = await client
          .from('entity_mentions')
          .select('id, canonical_name, op_id')
          .eq('id', mergedRowId)
          .single();
        expect(error).toBeNull();
        expect(row!.canonical_name).toBe(ADMIN_CANONICAL);
        expect(row!.op_id).toBe(opIdA);
      },
      // id-400: budget covers the mid-test staging's AWAITED walk (W2).
      POLL_TIMEOUT_MS * 2 + 360_000,
    );
  },
);
