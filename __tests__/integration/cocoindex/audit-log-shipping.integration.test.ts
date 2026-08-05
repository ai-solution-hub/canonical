/**
 * Integration test — PRODUCT Inv-13 (audit_log rows carry op_id for
 * pipeline-driven writes).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-13 statement (verbatim from
 * `docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Every `audit_log` row produced by a Postgres `AFTER INSERT / UPDATE /
 * > DELETE` trigger firing on a pipeline-driven write to a governed table
 * > carries the op_id of the originating pipeline run, so audit forensics
 * > can GROUP BY op_id to enumerate every audited change a given run
 * > made."
 *
 * Per P-OQ1 ratified default (PRODUCT.md §4 table): "Defer `audit_log`
 * table population to v1.1 — at v1 retain Inv-13 as a behaviour-contract
 * that v1.1 must satisfy; the v1 substrate is structured-log shipping
 * (Inv-22 + Inv-26). This aligns with RLS-PATTERN P-5 [DEFERRED-v1.1]."
 *
 * Per TECH §2.10: "`audit-log-shipping.integration.test.ts` (v1.1 substrate
 * replaces)". The v1 substrate is structured-log shipping; the v1.1
 * audit_log table is the canonical Inv-13 surface.
 *
 * Test strategy (v1 — structured-log substrate):
 *   Per the v1 substrate, Inv-13 verifiability translates to: every
 *   pipeline-driven write emits a structured log line (Cloud Run log
 *   stream) carrying the op_id. The integration test cannot directly
 *   read Cloud Run logs (requires logging-API access from CI), so the
 *   verifiable contract at v1 is the rollup observable: pipeline_runs.
 *   result carries the op_id, and that op_id is recoverable per Inv-12
 *   for any pipeline-driven corpus row.
 *
 * Test strategy (v1.1 — audit_log table substrate, FUTURE):
 *   Once the audit_log table lands per RLS-PATTERN v1.1, this test
 *   asserts:
 *     1. A pipeline-driven write to a governed table (content_items,
 *        q_a_extractions, entity_mentions, source_documents) produces an
 *        audit_log row.
 *     2. That audit_log row's op_id field matches the originating
 *        pipeline_runs.op_id.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase. Skip-clean local.
 *
 * Sub-test gating for v1.1 surface — the audit_log table check skips
 * cleanly when the table does not exist (v1 environment); the v1
 * substrate test (op_id-via-pipeline_runs) runs always.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-13 + P-OQ1.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-13.
 *   - docs/specs/id-38-rls-pattern/{PRODUCT,TECH}.md P-5 [DEFERRED-v1.1].
 *   - docs/plans/phase-0-investigation/architecture/02-data-flow.md §5
 *     (op_id + audit_log hybrid pattern).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';
import { stageFixture } from './_helpers/fixture-staging';
import { WALK_BUDGET_MS } from './_helpers/walk';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[28.18-INV13-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // v1 substrate only needs a pipeline-driven row with a resolvable op_id —
  // any fixture works; markdown is the fastest path.
  await stageFixture({
    fixturePath: '__tests__/fixtures/cocoindex-chunking/short-clause.md',
    destPath: `inv-13/${TEST_PREFIX}.md`,
    titlePrefix: TEST_PREFIX,
  });
}, WALK_BUDGET_MS + 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  // ID-131.19 M6 retirement: content_items DROPPED at M6; source_documents
  // replaces it as the seeded-row cleanup target.
  await client.from('source_documents').delete().in('id', seededContentIds);
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-13 — audit-log shipping (v1 substrate: op_id-via-pipeline_runs; v1.1 future: audit_log table)',
  () => {
    it(
      'v1 substrate: pipeline_runs.op_id is recoverable for every pipeline-driven source_documents row',
      async () => {
        const client = await createLiveServiceClient();

        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let contentItem: { id: string; op_id: string } | null = null;

        while (Date.now() < deadline) {
          // ID-131.19 M6 retirement: content_items DROPPED at M6;
          // source_documents.filename replaces content_items.title.
          const { data } = await client
            .from('source_documents')
            .select('id, op_id')
            .ilike('filename', `${TEST_PREFIX}%`)
            .limit(1);

          if (data && data.length > 0 && data[0]!.op_id) {
            contentItem = {
              id: data[0]!.id as string,
              op_id: data[0]!.op_id as string,
            };
            seededContentIds.push(contentItem.id);
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }

        expect(contentItem).not.toBeNull();

        // V1 substrate: the op_id is observable on the row (Inv-11 anchor)
        // AND resolves to a pipeline_runs row (Inv-12 anchor). At v1.1
        // this same op_id will be recoverable from audit_log entries.
        const { data: run } = await client
          .from('pipeline_runs')
          .select('id, op_id')
          .eq('op_id', contentItem!.op_id)
          .limit(1);

        expect(run).not.toBeNull();
        expect(run!.length).toBe(1);
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it('v1.1 substrate (FUTURE): audit_log row carries op_id matching pipeline_runs.op_id', async () => {
      const client = await createLiveServiceClient();

      // Probe for audit_log table existence. At v1 the table is intentionally
      // absent per RLS-PATTERN P-5 [DEFERRED-v1.1]; this test skips cleanly
      // until v1.1 lands.
      const { count: probeCount, error: probeError } = await client
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .limit(0);

      // id-400 (OQ-397-4 dead-test fix, census #41 #2): the table-absent
      // guard must ALSO treat a null count as absence. A `head: true`
      // request against a MISSING table does NOT reliably surface a truthy
      // `error` through supabase-js (no response body to parse — observed
      // live in the 2026-07-28 nightly: `error` null AND `count` null),
      // while an existing table always yields a numeric exact count (0 for
      // empty). The probeError-only guard fell through on exactly that
      // shape and failed the FUTURE assertion below against a table that
      // does not exist (TRIAGE §3.7 — the invariant is FUTURE; the test
      // must guard, not fail). Guard ported verbatim from the sibling
      // memo-hit-pipeline-run probe.
      if (probeError || probeCount === null) {
        // V1 environment — audit_log table absent (zero migrations). The
        // v1 substrate test above covers Inv-13; v1.1 activates this
        // assertion. (Defensive: leave a notable assertion so test output
        // records this branch was taken.)
        expect(probeError === null || probeError.message.length > 0).toBe(true);
        return;
      }

      // V1.1 substrate is live. Find audit_log rows for the test's
      // pipeline-driven writes. (ID-131.19 M6 retirement: content_items
      // DROPPED at M6; source_documents.filename replaces
      // content_items.title.)
      const { data: items } = await client
        .from('source_documents')
        .select('id, op_id')
        .ilike('filename', `${TEST_PREFIX}%`)
        .limit(1);

      if (!items || items.length === 0) {
        // No fixture landed yet — defer to the v1 test above.
        return;
      }

      const opId = items[0]!.op_id as string;

      // V1.1 contract: audit_log row(s) with table_name='source_documents'
      // for our source_document_id, carrying the same op_id. (ID-131.19 M6
      // retirement: content_items DROPPED at M6 — source_documents is now
      // the governed table a pipeline-driven write would land on.)
      const { data: auditRows } = await client
        .from('audit_log')
        .select('id, op_id, table_name, row_id, operation_type')
        .eq('table_name', 'source_documents')
        .eq('row_id', items[0]!.id as string);

      expect(auditRows).not.toBeNull();
      expect(auditRows!.length).toBeGreaterThan(0);

      // Inv-13 verifiability: every audit_log row produced by a
      // pipeline-driven write MUST carry the originating run's op_id.
      for (const row of auditRows!) {
        expect(row.op_id).toBe(opId);
      }
    }, 30_000);
  },
);
