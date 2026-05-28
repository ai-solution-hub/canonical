/**
 * Integration test — PRODUCT Inv-4 (memo-respecting idempotency on
 * content-hash match) — OQ-A ratified semantic (S265, Liam).
 *
 * Subtask ID-49.6 (S273 — was ID-28.18 lineage; updated to OQ-A semantic).
 *
 * Inv-4 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
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
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-4.
 *   - docs/specs/cocoindex-flow-scaffolding/RESEARCH.md §R4 (OQ-A
 *     memo-respecting op_id ratification).
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-4.
 *   - 28.14 sibling `extract-memoisation.integration.test.ts` (Inv-21 memo
 *     determinism — sibling concern).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[28.18-INV04-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // FUTURE: drop fixture, wait for first ingest, then trigger second poll
  // by touching the file (or wait for the natural poll cycle).
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  await client
    .from('q_a_extractions')
    .delete()
    .in('content_item_id', seededContentIds);
  // entity_mentions cleanup intentionally removed (ID-49.5 deferred per
  // S273 OQ-1 ratification — no entity-resolution assertions in 49.6).
  await client.from('content_items').delete().in('id', seededContentIds);
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
        const firstIngestDeadline = Date.now() + POLL_TIMEOUT_MS;
        let initialRow: { id: string; op_id: string } | null = null;

        while (Date.now() < firstIngestDeadline) {
          const { data } = await client
            .from('content_items')
            .select('id, op_id')
            .ilike('title', `${TEST_PREFIX}%`)
            .limit(1);
          if (data && data.length > 0 && data[0]!.op_id) {
            initialRow = {
              id: data[0]!.id as string,
              op_id: data[0]!.op_id as string,
            };
            seededContentIds.push(initialRow.id);
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }

        expect(initialRow).not.toBeNull();
        const opIdA = initialRow!.op_id;
        expect(opIdA).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );

        // Capture pre-second-pass q_a_extractions row count for the
        // legacy Inv-4 secondary assertion.
        const { count: extractionsBefore } = await client
          .from('q_a_extractions')
          .select('id', { count: 'exact', head: true })
          .eq('content_item_id', initialRow!.id);

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
          .eq('id', initialRow!.id)
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
          .eq('content_item_id', initialRow!.id);

        expect(extractionsAfter).toBe(extractionsBefore);
      },
      POLL_TIMEOUT_MS + 60_000,
    );
  },
);
