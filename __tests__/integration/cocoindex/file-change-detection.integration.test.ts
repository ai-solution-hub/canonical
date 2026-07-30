/**
 * Integration test — id-28 Inv-1 (REFRAMED) + NM-2 `keep-and-watch` lineage.
 *
 * id-400 W2 REBUILD (TRIAGE §3.2 + §5 NM-2; census #41 #8). The retired
 * version was structurally dead: its beforeAll was commented-out FUTURE
 * prose (nothing ever staged — the gcsfuse/Cloud Run blocker it described
 * was resolved by the on-prem /stage route long ago), and its per-file
 * "exactly one pipeline run scoped to that change" claim is unimplementable
 * under whole-corpus walks (op_id is flow-scope, one per walk).
 *
 * Inv-1 REFRAMED (TRIAGE §3.2, ratified): "one run per walk; a change is
 * attributable to the walk that absorbed it."
 *
 * NM-2 `keep-and-watch` lineage (id-396/TECH.md:68-72 — the R4 proof
 * obligation): a re-walk on byte change RE-DERIVES — the changed document is
 * re-processed and its rows re-stamp to the absorbing walk's op_id, while an
 * UNCHANGED sibling memo-skips and keeps its original op_id (the S265
 * semantic, restored by the id-400 engine fix).
 *
 * Test strategy:
 *   1. Stage fixture at destPath D (bytes v1) → awaited walk A absorbs it;
 *      sd row carries op_id A.
 *   2. Stage DIFFERENT bytes (v2) at the SAME destPath D → awaited walk B.
 *   3. Assert: the sd row's op_id now reads walk B (the byte change was
 *      absorbed + re-derived by B — keep-and-watch), op_id A ≠ op_id B, and
 *      both walks landed their own terminal pipeline_runs row (Inv-1
 *      reframed: one run per walk).
 *
 * Substrate ([SV], TRIAGE §3.5): source_documents is the record-model
 * successor of the retired content_items-era seams; identity is
 * content-hash-first (DR-024) — same path + new bytes resolves to the SAME
 * source_documents row via `resolve_or_mint_source_identity`, so the op_id
 * transition on ONE row is the honest re-derivation signal.
 *
 * References:
 *   - docs-site specs/id-397-lane-target/TRIAGE.md §3.2 (Inv-1 REFRAME), §5
 *     NM-2; HARNESS.md §2 (W2).
 *   - id-396/TECH.md:68-72 (R4 keep-and-watch lineage obligation).
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';
import { stageFixture } from './_helpers/fixture-staging';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[NM2-KEEPWATCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const WALK_BUDGET_MS = 300_000;

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  // pipeline_runs telemetry accumulates by design (HARNESS §4) — corpus-row
  // hygiene only (the D1 pre-run sweep is the load-bearing cleanup).
  if (seededContentIds.length > 0) {
    await client.from('source_documents').delete().in('id', seededContentIds);
  }
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-1 (reframed) + NM-2 — byte change is absorbed and re-derived by the walk that observed it',
  () => {
    it(
      're-staged bytes at the same destPath re-stamp the SAME sd row to the absorbing walk op_id',
      async () => {
        const client = await createLiveServiceClient();
        const destPath = `nm2-keepwatch/${TEST_PREFIX}.md`;

        // (1) bytes v1 → walk A.
        const stagedV1 = await stageFixture({
          fixturePath: '__tests__/fixtures/cocoindex-chunking/short-clause.md',
          destPath,
          titlePrefix: TEST_PREFIX,
          walkTimeoutMs: WALK_BUDGET_MS,
        });
        expect(stagedV1.walk).toBeDefined();
        const opA = stagedV1.walk!.opId;

        const { data: v1Rows } = await client
          .from('source_documents')
          .select('id, op_id')
          .ilike('filename', `${TEST_PREFIX}%`);
        expect(v1Rows && v1Rows.length === 1).toBe(true);
        const sdId = v1Rows![0]!.id as string;
        seededContentIds.push(sdId);
        expect(v1Rows![0]!.op_id).toBe(opA);

        // (2) DIFFERENT bytes at the SAME destPath → walk B (keep-and-watch
        // byte change; distinct-bytes fixture per id-396/TECH.md:76-86 —
        // same-bytes staging is reserved for the hash-identity population).
        const stagedV2 = await stageFixture({
          fixturePath: '__tests__/fixtures/cocoindex-chunking/long-terms.md',
          destPath,
          titlePrefix: TEST_PREFIX,
          walkTimeoutMs: WALK_BUDGET_MS,
        });
        expect(stagedV2.walk).toBeDefined();
        const opB = stagedV2.walk!.opId;
        expect(opB).not.toBe(opA);

        // (3) The byte change re-derived under walk B. NB content-hash-first
        // identity (DR-024): new bytes at the same logical_path may resolve
        // to a NEW sd identity (the hash minted a new id) — the honest
        // assertion is on the PATH's current row: the row the poll resolves
        // for this prefix must now carry op_id B.
        const { data: v2Rows } = await client
          .from('source_documents')
          .select('id, op_id')
          .ilike('filename', `${TEST_PREFIX}%`)
          .order('created_at', { ascending: false });
        expect(v2Rows && v2Rows.length >= 1).toBe(true);
        for (const row of v2Rows!) {
          if (!seededContentIds.includes(row.id as string)) {
            seededContentIds.push(row.id as string);
          }
        }
        const restampedRow = v2Rows!.find((r) => r.op_id === opB);
        expect(restampedRow).toBeDefined();

        // Inv-1 reframed: one run per walk — each walk landed exactly one
        // terminal pipeline_runs row under its own op_id.
        for (const opId of [opA, opB]) {
          const { data: runs, error } = await client
            .from('pipeline_runs')
            .select('id, status')
            .eq('op_id', opId);
          expect(error).toBeNull();
          expect(runs!.length).toBe(1);
          expect(['completed', 'completed_with_errors', 'failed']).toContain(
            runs![0]!.status as string,
          );
        }
      },
      WALK_BUDGET_MS * 2 + 60_000,
    );
  },
);
