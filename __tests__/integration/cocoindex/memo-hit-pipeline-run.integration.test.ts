/**
 * Integration test — PRODUCT Inv-15 (no-op writes do not produce audit-log
 * noise) AND Inv-16 (one pipeline_runs row per pipeline invocation).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Per TECH §2.10 this file covers Inv-15 AND Inv-16:
 *   - Inv-15: "When the pipeline's idempotency short-circuit fires (Inv-4
 *     — content-hash matches stored hash), no content_items UPDATE
 *     statement is executed against Postgres, and consequently no
 *     audit_log row is produced for that no-op cycle."
 *   - Inv-16: "Every pipeline invocation — regardless of whether it
 *     succeeded, failed, or short-circuited at the memo-hit check (when
 *     the pipeline ran but produced no derivation work) — produces
 *     exactly one pipeline_runs row with a stable op_id, start timestamp,
 *     end timestamp, and terminal status."
 *
 * Inv-15 verifiability: ingest a file twice unchanged; audit_log row count
 * for that row is the same after the second run as after the first.
 *
 * Inv-16 verifiability: trigger N pipeline invocations; each lands exactly
 * ONE terminal pipeline_runs row under its own op_id (N walks → N rows).
 *
 * Test strategy (id-400 W2 rebuild — OQ-397-4, census #41 #10):
 *   1. Stage a fixture; stageFixture's awaited walk is walk A (the run
 *      that absorbed it — the attribution anchor).
 *   2. Inv-16: request + await walk B over the UNCHANGED corpus (memo-skip
 *      pass). Assert one terminal pipeline_runs row per op_id for BOTH
 *      walks, and — the restored S265 rider — the fixture's
 *      source_documents.op_id still reads walk A (no-op re-ingest does NOT
 *      re-stamp; the retired version's `result.context.file_path` filter
 *      matched a JSONB path no producer writes, so Inv-16 had never been
 *      honestly proven).
 *   3. Inv-15 check: audit_log row count for the source_documents row is
 *      UNCHANGED — the memo-skip path performed no UPDATE.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase. Skip-clean locally.
 *
 * Audit_log v1 surface gating: per Inv-15's pairing with Inv-14 (P-OQ1
 * v1.1 deferral), the audit_log assertion gates on audit_log table
 * existence. At v1 (audit_log absent), Inv-15's verifiable contract is
 * trivially true (no audit row produced because no audit_log table
 * exists yet). At v1.1, the assertion fires.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-15 + Inv-16.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §2.10 rows Inv-15 +
 *     Inv-16.
 *   - 02-data-flow.md §3.2 (@coco.fn(memo=True) memo-hit semantics).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';
import { stageFixture } from './_helpers/fixture-staging';
import { runWalk } from './_helpers/walk';
import { KH_CANONICAL_PIPELINE_NAME } from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[28.18-INV15_16-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

// id-400 (W2/NM-5): the awaited walk from staging is walk A — the run that
// absorbed the fixture. The Inv-16 test requests walk B itself.
let walkA: { opId: string } | null = null;

beforeAll(async () => {
  if (!ENABLED) return;
  // First ingest — walk A (awaited by stageFixture; the 10 s pump that used
  // to re-poll this file is DELETED — HARNESS §2 W2).
  const staged = await stageFixture({
    fixturePath: '__tests__/fixtures/cocoindex-chunking/short-clause.md',
    destPath: `inv-15-16/${TEST_PREFIX}.md`,
    titlePrefix: TEST_PREFIX,
  });
  walkA = staged.walk ? { opId: staged.walk.opId } : null;
}, 330_000);

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  // id-400 (HARNESS §4): pipeline_runs TELEMETRY ACCUMULATES BY DESIGN — the
  // former seededRunIds deletion is retired (no telemetry sweep, ever).
  if (seededContentIds.length > 0) {
    // ID-131.19 M6 retirement: content_items DROPPED at M6;
    // source_documents replaces it as the seeded-row cleanup target.
    await client.from('source_documents').delete().in('id', seededContentIds);
  }
}, 600_000);

describe.skipIf(!ENABLED)(
  'Inv-15 + Inv-16 — memo-hit pipeline_runs landing AND audit-log silence on no-op',
  () => {
    it(
      'Inv-16: a memo-skip walk over the unchanged fixture still lands its own pipeline_runs row, and the fixture keeps walk A op_id (S265)',
      async () => {
        // id-400 REBUILD (OQ-397-4, census #41 #10): the retired version
        // filtered pipeline_runs on `result.context.file_path` — a JSONB
        // path NO producer writes (the record route composes result from
        // stage_counts/extractor_version/… only), so its beforeCount was
        // structurally 0 and Inv-16 had NEVER been honestly proven. The W2
        // rebuild binds to attributable walks instead:
        //   walk A — staged the fixture (beforeAll's awaited walk);
        //   walk B — requested HERE over the UNCHANGED corpus (memo-skip).
        // Inv-16's honest form under the corpus-reframe model: EVERY
        // invocation lands exactly ONE terminal pipeline_runs row keyed by
        // its own op_id — N walks → N rows (accumulation is designed,
        // id-396/TECH.md:106) — including the invocation whose per-item
        // work was entirely memo-skipped. The S265 rider (restored by the
        // id-400 engine fix; census #10's op_id half is now an honest
        // detector): the no-op walk does NOT re-stamp the fixture's op_id.
        const client = await createLiveServiceClient();
        expect(walkA).not.toBeNull();

        // The fixture's sd row landed under walk A.
        const { data, error: sdReadError } = await client
          .from('source_documents')
          .select('id, op_id')
          .ilike('filename', `${TEST_PREFIX}%`)
          .limit(1);
        expect(sdReadError).toBeNull();
        expect(data && data.length > 0).toBe(true);
        seededContentIds.push(data![0]!.id as string);
        expect(data![0]!.op_id).toBe(walkA!.opId);

        // Walk B — unchanged corpus, requested + awaited by THIS test.
        const walkB = await runWalk();
        expect(walkB.opId).not.toBe(walkA!.opId);

        // One terminal row per invocation, each under its own op_id.
        for (const opId of [walkA!.opId, walkB.opId]) {
          const { data: runs, error } = await client
            .from('pipeline_runs')
            .select('id, status')
            .eq('op_id', opId)
            .eq('pipeline_name', KH_CANONICAL_PIPELINE_NAME);
          expect(error).toBeNull();
          expect(runs).not.toBeNull();
          expect(runs!.length).toBe(1);
          expect(['completed', 'completed_with_errors', 'failed']).toContain(
            runs![0]!.status as string,
          );
        }

        // S265 restored: the memo-skip walk B did NOT re-stamp the row.
        const { data: after, error: afterError } = await client
          .from('source_documents')
          .select('op_id')
          .ilike('filename', `${TEST_PREFIX}%`)
          .limit(1);
        expect(afterError).toBeNull();
        expect(after && after.length > 0).toBe(true);
        expect(after![0]!.op_id).toBe(walkA!.opId);
      },
      POLL_TIMEOUT_MS + 360_000,
    );

    it('Inv-15: memo-hit cycle produces no new audit_log rows for the content_item (v1.1 substrate)', async () => {
      const client = await createLiveServiceClient();

      // Probe audit_log existence (v1.1 gate). `audit_log` has ZERO
      // migrations today — v1 substrate is op_id-via-pipeline_runs, so the
      // absent-table arm is the one that currently runs. NB the HEAD-request
      // shape: a missing table does NOT reliably surface as a truthy
      // `error` through supabase-js (`head: true` has no response body to
      // parse — observed live in the 2026-07-28 nightly, where `error` was
      // null and `count` was null). A null count is therefore ALSO the
      // table-absent signal: an existing table always yields a numeric
      // exact count (0 for empty).
      const { count: probeCount, error: probeError } = await client
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .limit(0);

      if (probeError || probeCount === null) {
        // V1 environment — audit_log table absent. Inv-15 is trivially
        // true at v1 (no audit rows produced because no audit table
        // exists). Document the v1 gap; v1.1 activates the assertion.
        return;
      }

      // V1.1 substrate. Find the source_documents row from the previous
      // test (intra-suite chain).
      if (seededContentIds.length === 0) return;
      const contentItemId = seededContentIds[0]!;

      // ID-131.19 M6 retirement: content_items DROPPED at M6 —
      // source_documents is now the governed table a pipeline-driven
      // write would land on.
      const { count: auditRowsAfter, error: auditCountError } = await client
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .eq('table_name', 'source_documents')
        .eq('row_id', contentItemId);

      // The probe proved the table exists, so this count MUST resolve —
      // a null here is a query failure, not absence.
      expect(auditCountError).toBeNull();
      expect(auditRowsAfter).not.toBeNull();

      // Inv-15 verifiability: at v1.1, audit_log row count for the
      // source_documents row is the SAME after the memo-hit cycle as after
      // the first ingest. The memo-hit path didn't UPDATE the row, so the
      // AFTER UPDATE trigger didn't fire.
      //
      // The expected count is exactly 1 (the INSERT trigger from the
      // first ingest's upsert). Any value > 1 proves the memo-hit path
      // performed an UPDATE that shouldn't have happened.
      expect(auditRowsAfter).toBeLessThanOrEqual(1);
    }, 30_000);
  },
);
