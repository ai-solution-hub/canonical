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

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[28.18-INV08-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededRunIds: string[] = [];
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

// Canonical extractor-identification keys per the webhook-bridge payload
// shape (28.13). At least one MUST be present in pipeline_runs.result.
const EXTRACTOR_ID_KEYS = [
  'extractor_image_sha',
  'extractor_build_tag',
  'docling_version',
  'sidecar_image',
  'image_sha',
  'build_tag',
] as const;

beforeAll(async () => {
  if (!ENABLED) return;
  // The extractor-identification metadata is stamped by the webhook bridge
  // at flow-end regardless of MIME (container-level fields, not
  // Docling-specific) — markdown direct ingest is the fastest path to a
  // successful run.
  await stageFixture({
    fixturePath: '__tests__/fixtures/cocoindex-chunking/short-clause.md',
    destPath: `inv-8/${TEST_PREFIX}.md`,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  if (seededRunIds.length > 0) {
    await client.from('pipeline_runs').delete().in('id', seededRunIds);
  }
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

        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let pipelineRunResult: Record<string, unknown> | null = null;

        while (Date.now() < deadline) {
          // ID-131.19 M6 retirement: content_items DROPPED at M6;
          // source_documents.filename replaces title.
          const { data: items } = await client
            .from('source_documents')
            .select('id, op_id')
            .ilike('filename', `${TEST_PREFIX}%`)
            .limit(1);

          if (items && items.length > 0 && items[0]!.op_id) {
            seededContentIds.push(items[0]!.id as string);
            const opId = items[0]!.op_id as string;
            const { data: runs } = await client
              .from('pipeline_runs')
              .select('id, result')
              .eq('op_id', opId)
              .eq('status', 'succeeded')
              .limit(1);

            if (runs && runs.length > 0) {
              seededRunIds.push(runs[0]!.id as string);
              pipelineRunResult = runs[0]!.result as Record<
                string,
                unknown
              > | null;
              break;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }

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
