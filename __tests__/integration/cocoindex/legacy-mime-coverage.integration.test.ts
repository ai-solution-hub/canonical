/**
 * Integration test — NM-3: legacy `.xls` / `.doc` mime coverage (id-400 mint).
 *
 * Source of obligation: id-396/TECH.md:48-52 (D3) — the corpus ADOPTED two
 * legacy-format orphans (`ITT Evaluation Matrix.xls`,
 * `rfp_onlinetdcops.doc`), minting "legacy .xls/.doc mime-coverage tests —
 * new lane test surface id-397 inherits" (TRIAGE §5 NM-3).
 *
 * HONEST CURRENT CONTRACT (what this file pins): the adapter's supported
 * file-corpus set is `.pdf/.docx/.xlsx` + text passthrough
 * (`adapters.py _DOCLING_EXTENSIONS`) — legacy OLE formats are NOT
 * convertible (docling has no .doc/.xls route), so a staged legacy file
 * fails LOUDLY per-item: the adapter raises `Unsupported file extension`,
 * the ID-80.9 per-item containment tallies it (`result.item_failures`), NO
 * partial rows land for the item, and the WALK ITSELF completes — one
 * file's fault never aborts the batch (id-28 Inv-22..27 discipline).
 *
 * DOCUMENTED GAP (owner-visible, the §5 named-skip precedent): the ADOPTED
 * corpus members remain unprocessable until an adapter route exists
 * (LibreOffice-convert or equivalent — an owner cost/deps decision, not a
 * harness fix). The named skip below keeps the full-ingestion contract
 * counted by the census instead of silently lost.
 *
 * References: id-396/TECH.md:48-52 (D3); TRIAGE §5 NM-3;
 * scripts/cocoindex_pipeline/adapters.py (suffix routing + loud reject).
 */

import { afterAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import { stageFixture } from './_helpers/fixture-staging';
import { FORM_TEMPLATE } from './_helpers/fixtures';
import { runWalk } from './_helpers/walk';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[NM3-LEGACY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;

const WALK_BUDGET_MS = 300_000;

const LEGACY_FIXTURES = [
  {
    kind: 'xls' as const,
    fixturePath: FORM_TEMPLATE.legacyEvaluationMatrixXls,
    destPath: `nm3-legacy/${TEST_PREFIX}-legacy.xls`,
  },
  {
    kind: 'doc' as const,
    fixturePath: FORM_TEMPLATE.legacyRfpOnlinetdcopsDoc,
    destPath: `nm3-legacy/${TEST_PREFIX}-legacy.doc`,
  },
];

afterAll(async () => {
  if (!ENABLED) return;
  // No sd rows land for legacy items under the current contract (the
  // adapter raises pre-write); defensive cleanup in case that changes.
  const client = await createLiveServiceClient();
  const { data } = await client
    .from('source_documents')
    .select('id')
    .ilike('filename', `${TEST_PREFIX}%`);
  if (data && data.length > 0) {
    await client
      .from('source_documents')
      .delete()
      .in(
        'id',
        data.map((r) => r.id as string),
      );
  }
}, 30_000);

describe.skipIf(!ENABLED)(
  'NM-3 — legacy .xls/.doc corpus members: loud per-item containment, walk survives',
  () => {
    it(
      'a walk over staged legacy files completes with contained item failures and zero partial rows',
      async () => {
        const client = await createLiveServiceClient();

        // Stage both legacy fixtures, then ONE awaited walk absorbs them
        // (batch staging = one staging event, HARNESS §2).
        for (const legacy of LEGACY_FIXTURES) {
          await stageFixture({
            fixturePath: legacy.fixturePath,
            destPath: legacy.destPath,
            titlePrefix: TEST_PREFIX,
            walk: false,
          });
        }
        const walk = await runWalk({ timeoutMs: WALK_BUDGET_MS });

        // The walk COMPLETED — a legacy item's fault is contained, never a
        // walk-wide failure (per-item containment; bl-224 cascade
        // inversion).
        expect(['completed', 'completed_with_errors']).toContain(walk.status);

        // The contained faults are OBSERVABLE: this walk's run row tallies
        // ≥ 2 content-branch item failures (one per legacy file).
        const { data: run, error: runError } = await client
          .from('pipeline_runs')
          .select('result')
          .eq('op_id', walk.opId)
          .maybeSingle();
        expect(runError).toBeNull();
        expect(run).not.toBeNull();
        const result = (run!.result ?? null) as Record<string, unknown> | null;
        const itemFailures =
          (result?.item_failures as Record<string, number> | undefined) ??
          undefined;
        expect(itemFailures).toBeDefined();
        expect(itemFailures!.content ?? 0).toBeGreaterThanOrEqual(2);

        // No-partial-writes: neither legacy item landed ANY sd row (the
        // adapter raises before the first write; a faulted item's declared
        // rows are discarded — {75.16}).
        const { data: sdRows, error: sdError } = await client
          .from('source_documents')
          .select('id')
          .ilike('filename', `${TEST_PREFIX}%`);
        expect(sdError).toBeNull();
        expect(sdRows ?? []).toHaveLength(0);
      },
      WALK_BUDGET_MS + 120_000,
    );

    // DOCUMENTED GAP — the adopted corpus members' FULL ingestion contract
    // (named skip so the census counts it; owner decision on an adapter
    // route for legacy OLE formats — D3 adoption gap).
    it.skip('SKIPPED[no-legacy-adapter-route]: adopted .xls/.doc corpus members ingest end-to-end (needs a legacy-format conversion route — owner cost/deps decision)', () => {
      // When an adapter route lands, promote this to the full ingestion
      // assertion (sd row + chunks per legacy file) and retire the
      // containment-only contract above to a regression guard.
    });
  },
);
