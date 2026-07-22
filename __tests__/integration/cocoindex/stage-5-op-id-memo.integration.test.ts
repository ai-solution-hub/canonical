/**
 * Integration test — PRODUCT Inv-7 (memo-respecting op_id on entity_mentions).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-7 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-7):
 *
 * > "op_id records the run that LAST MATERIALLY produced/changed the row, not
 * > the most recent run that merely scanned it. Ingest a file at run 1
 * > (op_id A) → rows have op_id A. Re-ingest the same file UNCHANGED at run 2
 * > (op_id B) → rows STILL show op_id A (memo SKIP). Trigger a full_reprocess
 * > at run 3 (op_id C) → rows show op_id C."
 *
 * Test strategy:
 *   1. Stage a fixture (run A); snapshot its entity_mentions op_id (= A).
 *   2. Re-stage byte-identical bytes (run B, memo path); assert the SAME rows
 *      still carry op_id A (no re-stamp on a memoised unchanged re-ingest).
 *   3. Stage with the full_reprocess directive (run C); assert the rows now
 *      carry a NEW op_id (C != A) — the reprocess re-ran every function and
 *      re-stamped.
 *
 * The full_reprocess directive is carried on the dest path
 * (`?fullReprocess=1`) — the fixture-staging service runs the pipeline in
 * cocoindex's full-reprocess update mode for that staging. A service that does
 * not support it 4xxs and the env-gate skip masks it.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-7.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-3, §P-9, §3.
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

const TEST_PREFIX = `[53.14-INV07-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

const FIXTURE_PATH =
  'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx';
const DEST = `inv-7/${TEST_PREFIX}.xlsx`;

beforeAll(async () => {
  if (!ENABLED) return;
  // Run A — first ingest at the canonical dest path.
  await stageFixture({
    fixturePath: FIXTURE_PATH,
    destPath: DEST,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-7 — memo-respecting op_id: unchanged re-ingest SKIPs, full_reprocess re-stamps',
  () => {
    it(
      'op_id A → unchanged re-ingest keeps A (memo) → full_reprocess yields C',
      async () => {
        // Run A: capture op_id A on the entity_mentions rows.
        const itemsA = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of itemsA) seededContentIds.push(r.id);
        const mentionsA = await pollEntityMentionsFor({
          titlePrefix: TEST_PREFIX,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(mentionsA.length).toBeGreaterThan(0);
        const opIdA = mentionsA[0]!.op_id;
        expect(opIdA).not.toBeNull();
        expect(opIdA!).toMatch(UUID_V4_REGEX);
        // All run-A rows carry op_id A.
        for (const m of mentionsA) expect(m.op_id).toBe(opIdA);
        const rowIds = mentionsA.map((m) => m.id);

        // Run B: re-stage the SAME bytes at the SAME dest (memo path — the
        // per-item ingest_file is memoised, so an unchanged re-ingest SKIPs
        // and does NOT re-stamp op_id).
        await stageFixture({
          fixturePath: FIXTURE_PATH,
          destPath: DEST,
          titlePrefix: TEST_PREFIX,
        });
        // Give the memo run time to settle, then re-read the SAME rows by id.
        const afterB = await pollEntityMentionsFor({
          contentItemIds: itemsA.map((r) => r.id),
          timeoutMs: POLL_TIMEOUT_MS,
          minRows: mentionsA.length,
        });
        const afterBById = new Map(afterB.map((m) => [m.id, m]));
        // Inv-7 memo SKIP: the original rows still carry op_id A.
        for (const id of rowIds) {
          const row = afterBById.get(id);
          if (row) expect(row.op_id).toBe(opIdA);
        }

        // Run C: full_reprocess directive — cocoindex re-runs every function
        // and re-stamps op_id. The rows now carry a NEW op_id C != A.
        await stageFixture({
          fixturePath: FIXTURE_PATH,
          destPath: `${DEST}?fullReprocess=1`,
          titlePrefix: TEST_PREFIX,
        });
        // Poll the original content_items' mentions until at least one of the
        // original rows shows a new op_id (the full_reprocess re-stamp).
        const contentItemIds = itemsA.map((r) => r.id);
        const opIdC = await pollForReStamp(contentItemIds, rowIds, opIdA!);
        expect(opIdC).not.toBeNull();
        expect(opIdC!).toMatch(UUID_V4_REGEX);
        expect(opIdC).not.toBe(opIdA);
      },
      POLL_TIMEOUT_MS * 3 + 60_000,
    );
  },
);

/**
 * Poll the given content_items' entity_mentions until one of the tracked
 * `rowIds` carries an op_id different from `previousOpId` (the full_reprocess
 * re-stamp). Returns the new op_id, or null on timeout.
 */
async function pollForReStamp(
  contentItemIds: string[],
  rowIds: string[],
  previousOpId: string,
): Promise<string | null> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const rows = await pollEntityMentionsFor({
      contentItemIds,
      timeoutMs: 5_000,
      pollIntervalMs: 2_000,
    }).catch(() => []);
    const restamped = rows.find(
      (r) =>
        rowIds.includes(r.id) && r.op_id !== null && r.op_id !== previousOpId,
    );
    if (restamped) return restamped.op_id;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return null;
}
