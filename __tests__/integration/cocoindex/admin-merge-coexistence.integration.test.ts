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
 * Test strategy (the op_id-scoping consequence at the data layer):
 *   1. Complete run A (pipeline corpus); capture op_id A + a row to "merge".
 *   2. Apply an admin-merge effect — UPDATE the run-A row's canonical_name to a
 *      distinctive admin value (the merge_entities RPC's net effect on
 *      canonical_name). The op_id stays A (admin curation does not re-stamp).
 *   3. Stage run B (a NEW corpus) and let its Stage-5 pass complete.
 *   4. Re-read the admin-merged run-A row; assert its canonical_name is STILL
 *      the admin value — run B's Stage-5 (op_id B) did not revert it.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-9.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-11, §3.
 *   - app/api/entities/merge/route.ts:48-52 (merge_entities RPC — canonical UPDATE).
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
import { pollEntityMentionsFor, UUID_V4_REGEX } from './test-helpers';

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

const FIXTURE_PATH =
  'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx';

beforeAll(async () => {
  if (!ENABLED) return;
  await stageFixture({
    fixturePath: FIXTURE_PATH,
    destPath: `inv-9/${RUN_A_PREFIX}.xlsx`,
    titlePrefix: RUN_A_PREFIX,
  });
}, 30_000);

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

        // Apply the admin-merge effect on a run-A row: UPDATE canonical_name to
        // a distinctive admin value (the net effect of merge_entities). op_id
        // stays A — admin curation does not re-stamp op_id.
        const client = await createLiveServiceClient();
        mergedRowId = runAMentions[0]!.id;
        const { error: mergeErr } = await client
          .from('entity_mentions')
          .update({ canonical_name: ADMIN_CANONICAL })
          .eq('id', mergedRowId);
        expect(mergeErr).toBeNull();

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
      POLL_TIMEOUT_MS * 2 + 30_000,
    );
  },
);
