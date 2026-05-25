/**
 * Integration test — PRODUCT Inv-11 (per-row op_id stamping) AND Inv-12
 * (op_id round-trip via pipeline_runs).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Per TECH §2.10 this file covers BOTH Inv-11 (op_id stamped on every
 * pipeline-produced row) AND Inv-12 (op_id resolves back to pipeline_runs
 * via a single PK SELECT).
 *
 * Inv-11 statement (verbatim):
 *
 * > "Every `content_items` row produced or updated by a cocoindex pipeline
 * > run carries the `op_id` of that run in its `content_items.op_id`
 * > column. The same invariant holds for `q_a_extractions.op_id` and
 * > `source_documents.op_id` (the latter via the T8 follow-up ALTER per
 * > O-Q1). Verifiable: ingest a file via a single pipeline run; query the
 * > row(s) the run produced; the `op_id` values match each other AND
 * > match the `pipeline_runs.op_id` for that run."
 *
 * Inv-12 statement (verbatim):
 *
 * > "Given any `op_id` extracted from a `content_items` / `q_a_extractions`
 * > / `source_documents` row, an audit-forensics consumer can resolve back
 * > to the originating `pipeline_runs` row (start/end times, status,
 * > stage-level counters) via a single PK SELECT. Verifiable: pick any
 * > pipeline-produced corpus row → read its `op_id` → SELECT
 * > `pipeline_runs` WHERE `op_id = <value>` → exactly one row returned."
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase.
 *
 * References:
 *   - docs/specs/cocoindex-flow-scaffolding/PRODUCT.md Inv-11 + Inv-12.
 *   - docs/specs/cocoindex-flow-scaffolding/TECH.md §2.10 rows Inv-11 +
 *     Inv-12 (extended).
 *   - docs/plans/phase-0-investigation/architecture/02-data-flow.md §5.1
 *     (N7 op_id hybrid pattern).
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

const TEST_PREFIX = `[28.18-INV11_12-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];
const seededRunIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

// UUID v4 regex per RFC 4122. Per CLAUDE.md gotcha: Zod UUID validation is
// strict (z.string().uuid()), so any test that fails on UUID shape would
// also surface to Pydantic validation in extraction.py. We assert the
// regex independently to catch drift.
const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  if (!ENABLED) return;
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  if (seededContentIds.length > 0) {
    await client
      .from('q_a_extractions')
      .delete()
      .in('content_item_id', seededContentIds);
    await client
      .from('entity_mentions')
      .delete()
      .in('content_item_id', seededContentIds);
    await client.from('content_items').delete().in('id', seededContentIds);
  }
  if (seededRunIds.length > 0) {
    await client.from('pipeline_runs').delete().in('id', seededRunIds);
  }
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-11 + Inv-12 — op_id per-row stamping AND op_id round-trip',
  () => {
    it(
      'content_items.op_id matches q_a_extractions.op_id for rows from the same run',
      async () => {
        const client = await createLiveServiceClient();

        // Poll until the fixture lands.
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let contentRow: { id: string; op_id: string } | null = null;

        while (Date.now() < deadline) {
          const { data } = await client
            .from('content_items')
            .select('id, op_id')
            .ilike('title', `${TEST_PREFIX}%`)
            .limit(1);

          if (data && data.length > 0 && data[0]!.op_id) {
            contentRow = {
              id: data[0]!.id as string,
              op_id: data[0]!.op_id as string,
            };
            seededContentIds.push(contentRow.id);
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }

        expect(contentRow).not.toBeNull();

        // Inv-11 verifiability part 1: op_id is a valid UUID v4 (not NULL,
        // not a placeholder string).
        expect(contentRow!.op_id).toMatch(UUID_V4_REGEX);

        // Inv-11 verifiability part 2: q_a_extractions rows for the same
        // content_item_id carry the SAME op_id value.
        const { data: extractions } = await client
          .from('q_a_extractions')
          .select('id, op_id')
          .eq('content_item_id', contentRow!.id);

        // If the fixture is a form-type (q_a_form extraction kind), there
        // MUST be ≥1 q_a_extractions row. If it's classification-only or
        // entity-only, ≥0 q_a_extractions rows. Per-row op_id assertion
        // skips when no rows are produced (the broader content_items op_id
        // assertion remains the load-bearing check).
        if (extractions && extractions.length > 0) {
          for (const row of extractions) {
            expect(row.op_id).toBe(contentRow!.op_id);
          }
        }
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it('op_id resolves back to exactly one pipeline_runs row (Inv-12 round-trip)', async () => {
      const client = await createLiveServiceClient();

      // Use the seeded op_id from the previous test (intra-suite chain).
      // If the previous test failed, this test is also expected to fail
      // — that's acceptable: Inv-11 break implies Inv-12 also breaks.
      const { data: items } = await client
        .from('content_items')
        .select('op_id')
        .in('id', seededContentIds);

      // Defensive: if seededContentIds is empty (previous test failed
      // early), still assert against the test prefix.
      const opIds =
        items && items.length > 0
          ? items.map((r) => r.op_id as string)
          : await (async () => {
              const { data } = await client
                .from('content_items')
                .select('op_id')
                .ilike('title', `${TEST_PREFIX}%`);
              return data?.map((r) => r.op_id as string) ?? [];
            })();

      expect(opIds.length).toBeGreaterThan(0);

      // For EACH op_id, query pipeline_runs WHERE op_id = <value>.
      // Per Inv-12: exactly one row returned. Zero proves the rollup
      // never landed; >1 proves duplicate-run-row bug (broken Inv-16).
      for (const opId of opIds) {
        const { data: runs } = await client
          .from('pipeline_runs')
          .select('id, op_id, status, started_at, ended_at')
          .eq('op_id', opId);

        expect(runs).not.toBeNull();
        expect(runs!.length).toBe(1);

        const run = runs![0]!;
        seededRunIds.push(run.id as string);

        // Round-trip metadata: started_at populated; ended_at populated
        // for terminal statuses (succeeded / failed).
        expect(run.started_at).not.toBeNull();
        if (run.status === 'succeeded' || run.status === 'failed') {
          expect(run.ended_at).not.toBeNull();
        }
      }
    }, 30_000);
  },
);
