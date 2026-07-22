/**
 * Integration test — PRODUCT Inv-5 (Stage-5 UPDATEs only current-run op_id rows).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-5 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-5):
 *
 * > "Stage-5 scopes its UPDATEs to `WHERE op_id = $current_run_op_id`. Ingest
 * > a corpus across two pipeline runs (op_id A in run 1, op_id B in run 2);
 * > after run 2 completes, ALL rows with op_id = A retain their run-1
 * > canonical_name regardless of what run 2's resolve_entities produced."
 *
 * Test strategy: stage corpus 1 (run A), capture its op_id + the
 * canonical_name snapshot of its entity_mentions; stage corpus 2 (run B) with
 * an overlapping entity surface that WOULD merge cross-corpus if op_id scope
 * were broken; after run B, re-read run-A's rows by op_id A and assert their
 * canonical_name is byte-identical to the run-1 snapshot (run B did not touch
 * them).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-5.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-6 step 6, §3.
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasRealLiveDbCredentials } from '../helpers/supabase-client';
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

const RUN_A_PREFIX = `[53.14-INV05-A-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const RUN_B_PREFIX = `[53.14-INV05-B-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

const FIXTURE_PATH =
  'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx';

beforeAll(async () => {
  if (!ENABLED) return;
  // Run A: corpus 1.
  await stageFixture({
    fixturePath: FIXTURE_PATH,
    destPath: `inv-5/${RUN_A_PREFIX}.xlsx`,
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
  'Inv-5 — Stage-5 UPDATEs are op_id-scoped to the current run',
  () => {
    it(
      'run-A rows retain their run-1 canonical_name after run B completes',
      async () => {
        // Run A lands.
        const itemsA = await pollContentItemsFor(RUN_A_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of itemsA) seededContentIds.push(r.id);
        const opIdA = itemsA.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opIdA).not.toBeNull();
        expect(opIdA!).toMatch(UUID_V4_REGEX);

        // Snapshot run-A's entity_mentions canonical_name by row id.
        const runAMentions = await pollEntityMentionsFor({
          opId: opIdA!,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(runAMentions.length).toBeGreaterThan(0);
        const runASnapshot = new Map(
          runAMentions.map((m) => [m.id, m.canonical_name]),
        );

        // Run B: a second corpus (overlapping entity surface). Stage it now so
        // its Stage-5 pass executes after run A's rows are committed.
        await stageFixture({
          fixturePath: FIXTURE_PATH,
          destPath: `inv-5/${RUN_B_PREFIX}.xlsx`,
          titlePrefix: RUN_B_PREFIX,
        });
        const itemsB = await pollContentItemsFor(RUN_B_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of itemsB) seededContentIds.push(r.id);
        const opIdB = itemsB.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opIdB).not.toBeNull();
        // Two distinct runs → distinct op_ids.
        expect(opIdB).not.toBe(opIdA);

        // Wait for run B's entity_mentions to exist (proxy for run B's Stage-5
        // having executed).
        await pollEntityMentionsFor({
          opId: opIdB!,
          timeoutMs: POLL_TIMEOUT_MS,
        });

        // Inv-5 verifiability: re-read run-A's rows by op_id A. Every row's
        // canonical_name is byte-identical to the run-1 snapshot — run B's
        // Stage-5 pass did NOT touch them (op_id scope held).
        const runARecheck = await pollEntityMentionsFor({
          opId: opIdA!,
          timeoutMs: POLL_TIMEOUT_MS,
          minRows: runAMentions.length,
        });
        for (const m of runARecheck) {
          const before = runASnapshot.get(m.id);
          if (before !== undefined) {
            expect(m.canonical_name).toBe(before);
            // op_id never re-stamped to B.
            expect(m.op_id).toBe(opIdA);
          }
        }
      },
      POLL_TIMEOUT_MS * 2 + 30_000,
    );
  },
);
