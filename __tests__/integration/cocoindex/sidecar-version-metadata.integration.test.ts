/**
 * Integration test — PRODUCT Inv-8 (sidecar version metadata).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-8 statement (verbatim from
 * `docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "Every `pipeline_runs` row produced by a sidecar invocation carries
 * > metadata identifying the sidecar image (e.g. an image-SHA, build-tag,
 * > or equivalent stable identifier) sufficient for forensic correlation
 * > between a corpus row and the extractor build that produced it.
 * > Verifiable: query `pipeline_runs.metadata` (or equivalent column) for
 * > any successful run; the result MUST contain an extractor-identification
 * > field that can be cross-referenced against the Cloud Run image-deploy
 * > log."
 *
 * Test strategy:
 *   1. Wait for a pipeline_runs row from a successful flow run (poll on
 *      source_documents.filename with the test prefix → resolve op_id →
 *      find pipeline_runs row; ID-131.19 M6 retirement: content_items
 *      DROPPED at M6).
 *   2. Assert pipeline_runs.result (JSONB) carries at least one of the
 *      canonical extractor-identification fields: extractor_image_sha,
 *      extractor_build_tag, docling_version, or sidecar_image.
 *
 * Per 28.13/28.15 wiring this metadata is stamped onto the
 * `pipeline_runs.result` JSONB column by the webhook bridge from the
 * cocoindex sidecar payload. The exact key may evolve as the sidecar
 * matures — the test accepts ANY of the canonical extractor-identifier
 * keys to remain resilient to that evolution while still policing the
 * Inv-8 contract.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-8.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-8.
 *   - app/api/internal/pipeline-runs/record/route.ts (webhook bridge —
 *     stamps the extractor metadata into pipeline_runs.result).
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

const TEST_PREFIX = `[28.18-INV08-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

// Canonical extractor-identification keys per the record route's ACTUAL
// composed result shape (app/api/internal/pipeline-runs/record/route.ts).
// id-400 (OQ-397-4 dead-test fix, census #41 #15): `extractor_version` — the
// ONLY key the route writes (sourced from the sidecar's IMAGE_SHA) — was
// missing from this list, so the assertion failed even on a perfect run. The
// legacy speculative keys are kept as accepted alternates (a future bridge
// may stamp richer identity), but the real stamped key leads. Mirrors the
// corrected list in extractor-version-cross-ref.integration.test.ts.
const EXTRACTOR_ID_KEYS = [
  'extractor_version',
  'extractor_image_sha',
  'extractor_build_tag',
  'docling_version',
  'sidecar_image',
  'image_sha',
  'build_tag',
] as const;

// id-400 (W2/NM-5): the awaited walk from staging is the attribution anchor —
// its opId is the run this fixture was absorbed by.
let stagedWalkOpId: string | null = null;

beforeAll(async () => {
  if (!ENABLED) return;
  // The extractor-identification metadata is stamped by the webhook bridge
  // at flow-end regardless of MIME (container-level fields, not
  // Docling-specific) — markdown direct ingest is the fastest path to a
  // successful run.
  const staged = await stageFixture({
    fixturePath: '__tests__/fixtures/cocoindex-chunking/short-clause.md',
    destPath: `inv-8/${TEST_PREFIX}.md`,
    titlePrefix: TEST_PREFIX,
  });
  stagedWalkOpId = staged.walk?.opId ?? null;
}, WALK_BUDGET_MS + 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  // id-400 (HARNESS §4): pipeline_runs TELEMETRY ACCUMULATES BY DESIGN —
  // census comparability requires history, so the former seededRunIds
  // deletion is retired (no telemetry sweep, ever). Only the
  // fixture-prefixed corpus row is cleaned (hygiene — the D1 pre-run sweep
  // is the load-bearing cleanup).
  if (seededContentIds.length > 0) {
    // ID-131.19 M6 retirement: content_items DROPPED at M6; seededContentIds
    // holds source_documents.id values.
    await client.from('source_documents').delete().in('id', seededContentIds);
  }
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-8 — sidecar version metadata in pipeline_runs.result',
  () => {
    it(
      'pipeline_runs row from successful flow carries at least one canonical extractor-identification field',
      async () => {
        const client = await createLiveServiceClient();

        // id-400 (W2/NM-5): bind to the walk that ABSORBED the staged
        // fixture — stageFixture's awaited walk (the attribution anchor) —
        // instead of the retired hand-rolled poll, whose
        // `.eq('status', 'succeeded')` filter matched NOTHING (the enum is
        // in_progress|completed|completed_with_errors|failed — census #41
        // #15's first defect). awaitWalk already proved the run row is
        // terminal, so a single status-honest read suffices here.
        expect(stagedWalkOpId).not.toBeNull();

        // Substrate note ([SV], TRIAGE §3.5): source_documents.filename is
        // the successor of the retired content_items.title seam.
        const { data: items, error: itemsError } = await client
          .from('source_documents')
          .select('id, op_id')
          .ilike('filename', `${TEST_PREFIX}%`)
          .limit(1);
        expect(itemsError).toBeNull();
        if (items && items.length > 0) {
          seededContentIds.push(items[0]!.id as string);
        }

        const { data: runs, error: runsError } = await client
          .from('pipeline_runs')
          .select('id, result, status')
          .eq('op_id', stagedWalkOpId!)
          .in('status', ['completed', 'completed_with_errors'])
          .limit(1);
        expect(runsError).toBeNull();
        expect(runs && runs.length > 0).toBe(true);
        const pipelineRunResult = runs![0]!.result as Record<
          string,
          unknown
        > | null;

        expect(pipelineRunResult).not.toBeNull();

        // Inv-8 verifiability: at LEAST ONE of the canonical extractor-
        // identification keys MUST be present. Missing ALL of them proves
        // the webhook bridge isn't stamping extractor metadata onto
        // pipeline_runs.result — no way to cross-reference a corpus row to
        // its producing build.
        const hasExtractorId = EXTRACTOR_ID_KEYS.some((key) => {
          const value = pipelineRunResult![key];
          return typeof value === 'string' && (value as string).length > 0;
        });

        expect(hasExtractorId).toBe(true);
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
