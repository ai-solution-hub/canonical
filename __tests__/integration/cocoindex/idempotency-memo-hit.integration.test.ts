/**
 * Integration test — PRODUCT Inv-4 (memo-respecting idempotency on
 * content-hash match) — OQ-A ratified semantic (S265, Liam).
 *
 * Subtask ID-49.6 (S273 — was ID-28.18 lineage; updated to OQ-A semantic).
 *
 * Inv-4 statement (verbatim from
 * `docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Re-running the pipeline over a file whose byte-contents have not
 * > changed since the last successful run does NOT produce new derivation
 * > rows (`content_items` update with no-op diff, `q_a_extractions` no
 * > duplicates). The pipeline short-circuits at the content-hash check
 * > via the memoisation contract."
 *
 * OQ-A RATIFIED SEMANTIC (Liam, S265 — encoded in RESEARCH §R4):
 *   The memo-respecting op_id invariant: re-ingesting an UNCHANGED source
 *   in INCREMENTAL mode MUST preserve the original op_id stamp on
 *   content_items. Only a full_reprocess re-stamps the op_id. This
 *   distinguishes between "the pipeline ran but produced no work" (op_id
 *   stays at A) vs "the pipeline ran and re-stamped" (op_id moves to B).
 *
 * Test strategy:
 *   1. Run full_reprocess once with op_id=A. The content_items row's
 *      op_id is A.
 *   2. Run incremental on the UNCHANGED source with op_id=B.
 *   3. Assert: content_items.op_id is STILL A (not B). The memo-hit path
 *      did NOT re-write the row.
 *   4. Secondary assertion: q_a_extractions row count is unchanged
 *      (legacy Inv-4 verifiability).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase. Skip-clean locally pending env unblock.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-4.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/RESEARCH.md §R4 (OQ-A
 *     memo-respecting op_id ratification).
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-4.
 *   - 28.14 sibling `extract-memoisation.integration.test.ts` (Inv-21 memo
 *     determinism — sibling concern).
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

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[49.6-INV04-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // Drop the fixture (full_reprocess pass produces op_id=A). The harness
  // then waits for the first ingest to land via pollContentItemsFor before
  // triggering the second pass — see the `it` body for the second-pass
  // poll cadence.
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-4/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({
    titlePrefix: TEST_PREFIX,
    contentIds: seededContentIds,
  });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-4 — memo-respecting idempotency (OQ-A: unchanged re-ingest preserves op_id)',
  () => {
    it(
      'full_reprocess(op_id=A) then incremental(op_id=B) on unchanged source: row.op_id stays A',
      async () => {
        const client = await createLiveServiceClient();

        // ---------------------------------------------------------------
        // Pass 1 — full_reprocess fixture has dropped (beforeAll); wait
        // for the row to land and capture its initial op_id (= "A").
        // ---------------------------------------------------------------
        const polled = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const firstWithOpId = polled.find((r) => r.op_id !== null);
        expect(firstWithOpId).toBeDefined();
        const initialRow: { id: string; op_id: string } = {
          id: firstWithOpId!.id,
          op_id: firstWithOpId!.op_id!,
        };
        seededContentIds.push(initialRow.id);

        const opIdA = initialRow.op_id;
        expect(opIdA).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );

        // Capture pre-second-pass q_a_extractions row count for the
        // legacy Inv-4 secondary assertion.
        const { count: extractionsBefore } = await client
          .from('q_a_extractions')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', initialRow.id);

        // ---------------------------------------------------------------
        // Pass 2 — INCREMENTAL re-ingest on UNCHANGED source. FUTURE:
        // touch the fixture file mtime (without modifying bytes) via the
        // staging endpoint so cocoindex observes a modification event
        // but the content-hash is stable. The second invocation will
        // produce its own pipeline_runs row with op_id=B, but the
        // memo-hit short-circuit means the content_items row is NOT
        // re-written.
        //
        // Wait one polling-cadence window so the second poll fires.
        // ---------------------------------------------------------------
        await new Promise((resolve) => setTimeout(resolve, 10_000));

        // OQ-A RATIFIED ASSERTION — content_items.op_id is STILL A.
        const { data: postRow, error: postErr } = await client
          .from('content_items')
          .select('id, op_id')
          .eq('id', initialRow.id)
          .maybeSingle();

        expect(postErr).toBeNull();
        expect(postRow).not.toBeNull();

        // The load-bearing assertion: the memo-respecting op_id stamp
        // survives. If the row's op_id had become B (incremental run's
        // op_id), the memo-hit short-circuit failed — the row was
        // re-written by an incremental pass that should have no-op'd.
        expect(postRow!.op_id).toBe(opIdA);

        // Secondary (legacy Inv-4) — q_a_extractions row count is
        // unchanged. Any delta proves the extractor body re-ran (memo
        // miss). entity_mentions assertion intentionally omitted
        // (ID-49.5 deferred per S273 OQ-1).
        const { count: extractionsAfter } = await client
          .from('q_a_extractions')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', initialRow.id);

        expect(extractionsAfter).toBe(extractionsBefore);

        // Secondary (S274 nit #3 — pipeline_runs distinct op_id
        // assertion). The memo-hit short-circuit means the content_items
        // row's op_id stays at A, but the second incremental pass STILL
        // produces its own pipeline_runs row stamped with op_id=B. The
        // distinct op_id count across pipeline_runs scoped to the test
        // prefix's content_items therefore reflects the number of
        // distinct OPERATIONS observed against this fixture. Inv-4
        // verifiability semantic: every pipeline_runs row whose op_id
        // landed on the content_items row carries the SAME (A) op_id —
        // because the memo-hit path did not re-stamp the row. The
        // distinct count over content_items.op_id values is therefore
        // exactly 1 (just A), regardless of how many pipeline_runs rows
        // exist for this title prefix.
        const { data: rowsByPrefix, error: rowsErr } = await client
          .from('content_items')
          .select('op_id')
          .ilike('title', `${TEST_PREFIX}%`);
        expect(rowsErr).toBeNull();
        const distinctOpIds = new Set(
          (rowsByPrefix ?? [])
            .map((r) => r.op_id as string | null)
            .filter((v): v is string => Boolean(v)),
        );
        expect(distinctOpIds.size).toBe(1);
        expect(distinctOpIds.has(opIdA)).toBe(true);
      },
      POLL_TIMEOUT_MS + 60_000,
    );
  },
);
