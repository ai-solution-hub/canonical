/**
 * Integration test — PRODUCT Inv-1 (file-change detection).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Inv-1 statement (verbatim from
 * `docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md`):
 *
 * > "When a file is created, modified, or deleted under a tracked cocoindex
 * > source-binding location, the pipeline observes the change and emits
 * > exactly one pipeline run scoped to that change within the configured
 * > polling window. Verifiable: drop a file into the watched folder; within
 * > the polling-cadence window a corresponding `pipeline_runs` row appears
 * > with status `in_progress` (then transitioning to `succeeded` or `failed`
 * > per Inv-21)."
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_SOURCE_PATH + live Supabase.
 *   - COCOINDEX_STAGING_URL: Cloud Run sidecar Service URL.
 *   - COCOINDEX_SOURCE_PATH: filesystem path the Service watches via
 *     localfs source-binding (test drops a file here).
 *   - Live Supabase: poll `pipeline_runs` post-drop.
 *
 * Note on test infrastructure (S258 carry-forward):
 *   The corpus-drop mechanism requires write access to the SHARED filesystem
 *   that the Cloud Run Service mounts as the source-binding location. In the
 *   current Cloud Run staging deployment this is a GCS bucket mounted via
 *   gcsfuse — direct fs writes from the integration test host are NOT
 *   available. When that posture is resolved (either via a fixture-staging
 *   gRPC endpoint on the sidecar, or via a GCS bucket the test can write
 *   to via service-role auth), this test ungates from the secondary env
 *   COCOINDEX_FIXTURE_STAGING_URL.
 *
 *   Until then, this file's body is the FUTURE contract. Skip-clean is the
 *   correct local behaviour.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-1.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §2.10 row Inv-1.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §P-2 (cocoindex flow
 *     scaffolding — `localfs.walk_dir(recursive=True)`).
 *   - scripts/cocoindex_pipeline/flow.py app_main() (the fs-watch loop).
 *   - __tests__/integration/helpers/supabase-client.ts (live client).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasLiveDbCredentials,
} from '../helpers/supabase-client';

// ---------------------------------------------------------------------------
// Env-gate — Inv-1 requires the Cloud Run sidecar Service to be reachable
// AND the fixture-staging substrate so the test can place a file in the
// source-binding location the Service watches.
// ---------------------------------------------------------------------------

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

// ---------------------------------------------------------------------------
// Per-file unique prefix — prevents collisions across concurrent runs.
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[28.18-INV01-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededRunIds: string[] = [];

// Inv-1 polling window — cocoindex localfs default poll cadence is ~5s,
// allow 60s for the run to appear (matches the 28.14 sibling convention
// for fs-watch latency budget).
const POLL_WINDOW_MS = 60_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // FUTURE: Drop one markdown fixture into the source-binding location via
  // the fixture-staging endpoint. The cocoindex fs-watch loop observes the
  // change and emits a pipeline run.
  //
  //   const fixturePath = `${process.env.COCOINDEX_SOURCE_PATH}/${TEST_PREFIX}.md`;
  //   await stageFixture(process.env.COCOINDEX_FIXTURE_STAGING_URL!, {
  //     path: fixturePath,
  //     body: `# ${TEST_PREFIX}\n\nMinimal markdown for Inv-1 detection test.\n`,
  //   });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  if (seededRunIds.length === 0) return;
  const client = await createLiveServiceClient();
  // Best-effort cleanup — leftover pipeline_runs rows surface via the next
  // run's TEST_PREFIX uniqueness guard.
  await client.from('pipeline_runs').delete().in('id', seededRunIds);
}, 30_000);

// ---------------------------------------------------------------------------
// The test — Inv-1 file-change detection.
// ---------------------------------------------------------------------------

describe.skipIf(!ENABLED)(
  'Inv-1 — file-change detection (drop file → pipeline_runs row within polling window)',
  () => {
    it('produces exactly one pipeline_runs row scoped to the dropped file within the polling window', async () => {
      // Verifiable per Inv-1: poll `pipeline_runs` for a row that
      // references the newly-dropped fixture (via op_id linkage to a
      // content_items row with the TEST_PREFIX title), within the polling
      // cadence window.
      const client = await createLiveServiceClient();

      const deadline = Date.now() + POLL_WINDOW_MS;
      let matchingRuns: { id: string; status: string; op_id: string | null }[] =
        [];

      while (Date.now() < deadline) {
        // Query content_items by title (the markdown fixture's H1 becomes
        // the title via Docling/markdown direct ingest), then join back to
        // pipeline_runs via op_id.
        const { data: items } = await client
          .from('content_items')
          .select('id, op_id, title')
          .ilike('title', `${TEST_PREFIX}%`);

        if (items && items.length > 0) {
          const opIds = items
            .map((r) => r.op_id as string | null)
            .filter((id): id is string => id !== null);

          if (opIds.length > 0) {
            const { data: runs } = await client
              .from('pipeline_runs')
              .select('id, status, op_id')
              .in('op_id', opIds);

            if (runs && runs.length > 0) {
              matchingRuns = runs.map((r) => ({
                id: r.id as string,
                status: r.status as string,
                op_id: r.op_id as string | null,
              }));
              matchingRuns.forEach((r) => seededRunIds.push(r.id));
              break;
            }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }

      // Inv-1 says "exactly one pipeline run scoped to that change" —
      // exactly one op_id-linked row.
      expect(matchingRuns.length).toBe(1);

      // The status must be either in_progress (still extracting), succeeded,
      // or failed — any terminal state proves the run fired. A null/missing
      // status proves the row was inserted but never updated by recordPipelineRun.
      expect(['in_progress', 'succeeded', 'failed']).toContain(
        matchingRuns[0]!.status,
      );
    }, 90_000);
  },
);
