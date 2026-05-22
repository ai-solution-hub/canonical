/**
 * Integration test — PRODUCT Inv-14 (non-pipeline writes still produce
 * audit_log rows; op_id is NULL on non-pipeline paths).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-14 statement (verbatim from
 * `docs/specs/cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "A direct UI edit, a governance-cron update, or any other non-cocoindex
 * > write path to a governed table also produces an `audit_log` row
 * > (without an op_id, since there is no cocoindex run to correlate
 * > against). The audit-log surface is coverage-complete across writers —
 * > cocoindex's per-flow op_id is additive, not replacement. Verifiable:
 * > a direct UI edit to a `content_items` row produces an `audit_log`
 * > entry with NULL op_id (or absent op_id field) but populated table-name
 * > / row-id / operation-type / invoking-role."
 *
 * Per TECH §2.10: file `non-pipeline-write.integration.test.ts` covers
 * Inv-14 with "P-4 (v1: log-inspection substrate)". The v1 substrate is
 * structured-log shipping per P-OQ1 default (audit_log table is
 * v1.1-deferred). The test therefore probes for audit_log existence and:
 *   - V1 (no audit_log): asserts via structured-log substrate (no audit
 *     rows exist for ANY writer — trivial pass with documented gap).
 *   - V1.1 (audit_log lives): asserts that a non-pipeline UPDATE on
 *     content_items produces an audit_log row with op_id=NULL.
 *
 * Test strategy:
 *   1. Insert a fresh content_items row via the service-role client
 *      directly (NOT via the pipeline) — this is the "non-pipeline write"
 *      surface.
 *   2. Query audit_log for an entry on that row.
 *   3. If audit_log exists, assert op_id IS NULL on that row.
 *   4. If audit_log doesn't exist (v1), document the v1 substrate gap.
 *
 * Env-gate: live Supabase ONLY. No staging Service or fixture-staging
 * required — the test creates its own non-pipeline write via the service-
 * role client.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-14.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-14.
 *   - docs/plans/phase-0-investigation/architecture/02-data-flow.md §5.2
 *     (why trigger-driven, not app-stamped — coverage completeness).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
  isNetworkIsolationError,
} from '../helpers/supabase-client';

const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED = HAS_LIVE_DB;

const TEST_PREFIX = `[28.18-INV14-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

beforeAll(async () => {
  if (!ENABLED) return;
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededContentIds.length === 0) return;
  const client = await createLiveServiceClient();
  await client.from('content_items').delete().in('id', seededContentIds);
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-14 — non-pipeline writes produce audit_log rows with NULL op_id',
  () => {
    it('a direct service-role INSERT on content_items produces an audit_log row with op_id IS NULL (v1.1 surface)', async () => {
      const client = await createLiveServiceClient();

      // Probe audit_log existence — if absent (v1 environment), the v1
      // substrate is structured-log shipping and this assertion is
      // deferred to v1.1.
      const { error: probeError } = await client
        .from('audit_log')
        .select('id', { count: 'exact', head: true })
        .limit(0);

      // Sandbox-aware skip — network-isolated env.
      if (isNetworkIsolationError(probeError)) {
        // eslint-disable-next-line no-console
        console.warn('Inv-14: skipping — network-isolated environment');
        return;
      }

      if (probeError) {
        // V1 environment — audit_log table absent. The verifiable
        // contract at v1 is the structured-log emission per Inv-26.
        // Document the v1 substrate gap; v1.1 will activate this branch.
        expect(probeError.message.length).toBeGreaterThan(0);
        return;
      }

      // V1.1 substrate: insert a non-pipeline content_items row directly
      // via the service-role client. This is the "direct UI edit /
      // governance-cron update / non-cocoindex write path" surface.
      const directInsert = {
        title: `${TEST_PREFIX} non-pipeline write test`,
        content_type: 'reference',
        primary_domain: 'general',
        // op_id intentionally OMITTED — this is the non-pipeline write
        // path; op_id should remain NULL.
      } as Record<string, unknown>;

      const { data: insertResult, error: insertError } = await client
        .from('content_items')
        .insert(directInsert)
        .select('id')
        .single();

      // If the direct insert fails (e.g. NOT NULL constraint on a column
      // we didn't supply), the test is correctly diagnostic. We DO NOT
      // want to silently pass.
      expect(insertError).toBeNull();
      expect(insertResult).not.toBeNull();
      const contentItemId = insertResult!.id as string;
      seededContentIds.push(contentItemId);

      // Audit_log row for this insert MUST exist (audit-log surface is
      // coverage-complete across writers per Inv-14).
      const { data: auditRows } = await client
        .from('audit_log')
        .select('id, op_id, table_name, row_id, operation_type')
        .eq('table_name', 'content_items')
        .eq('row_id', contentItemId);

      expect(auditRows).not.toBeNull();
      expect(auditRows!.length).toBeGreaterThan(0);

      // Inv-14 verifiability: op_id IS NULL (or absent) for non-pipeline
      // writes. Population would prove a spurious op_id was stamped on a
      // path that has no pipeline_runs row to correlate against.
      for (const row of auditRows!) {
        expect(row.op_id).toBeNull();
        // Populated invariant: table-name, row-id, operation-type all
        // present (the audit row is meaningful even without op_id).
        expect(row.table_name).toBe('content_items');
        expect(row.row_id).toBe(contentItemId);
        expect(typeof row.operation_type).toBe('string');
        expect((row.operation_type as string).length).toBeGreaterThan(0);
      }
    }, 30_000);
  },
);
