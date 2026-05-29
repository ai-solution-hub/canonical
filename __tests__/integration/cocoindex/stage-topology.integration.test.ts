/**
 * Integration test — PRODUCT Inv-3 (six-stage topology observable per
 * document) AND Inv-17 (per-stage counters in pipeline_runs row, extended).
 *
 * Subtask ID-28.18 (S258 W3 — remainder of TECH §2.10 coverage matrix).
 *
 * Per TECH §2.10 the `stage-topology.integration.test.ts` file is the
 * acceptance test for BOTH Inv-3 (the six-stage shape is observable
 * end-to-end) AND Inv-17 (per-stage counters / stage-completion rollup on
 * each `pipeline_runs` row).
 *
 * Inv-3 statement (verbatim):
 *
 * > "Each pipeline run executes the six canonical stages — source walk →
 * > binary conversion → LLM extraction → embedding → entity resolution →
 * > Postgres UPSERT — in order, and an external observer can determine for
 * > any given document which stage it last reached. Verifiable: a run that
 * > fails at the embedding stage MUST report the failure stage explicitly
 * > (per Inv-22 structured-log shape); a run that completes MUST have
 * > written embeddings to `content_items.embedding`."
 *
 * Inv-17 statement (verbatim):
 *
 * > "Each `pipeline_runs` row exposes per-stage observability — at minimum
 * > a count or boolean of stage-completion for the six canonical stages
 * > (source walk, binary conversion, LLM extraction, embedding, entity
 * > resolution, Postgres UPSERT). Verifiable: query any `pipeline_runs` row
 * > and resolve a per-stage rollup (e.g. `stage_counts.binary_conversion =
 * > N`, `stage_counts.llm_extraction = M`)."
 *
 * Schema reference: per `app/api/internal/pipeline-runs/record/route.ts`
 * lines 52-59 (StageCountsSchema), the six stages land as nonneg int counts
 * in `pipeline_runs.result.stage_counts` (JSONB). Schema is enforced by the
 * Zod schema on the webhook bridge.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * live Supabase.
 *
 * References:
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/PRODUCT.md Inv-3 + Inv-17.
 *   - docs/specs/id-28-cocoindex-flow-scaffolding/TECH.md §2.10 rows Inv-3 +
 *     Inv-17 (extended).
 *   - app/api/internal/pipeline-runs/record/route.ts (StageCountsSchema).
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

const TEST_PREFIX = `[28.18-INV03-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededRunIds: string[] = [];
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

// Canonical 7-stage vocabulary per PRODUCT.md Inv-3 + 02-data-flow.md §3.1
// + StageCountsSchema in pipeline-runs/record route, extended by the ID-56.8
// `chunking` stage (Inv-11 elevation — the cocoindex RecursiveSplitter
// chunk-row writer).
const CANONICAL_STAGES = [
  'source_walk',
  'binary_conversion',
  'llm_extraction',
  'embedding',
  'entity_resolution',
  'chunking',
  'postgres_upsert',
] as const;

beforeAll(async () => {
  if (!ENABLED) return;
  // FUTURE: drop a markdown fixture and wait for ingest to complete.
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  const client = await createLiveServiceClient();
  if (seededRunIds.length > 0) {
    await client.from('pipeline_runs').delete().in('id', seededRunIds);
  }
  if (seededContentIds.length > 0) {
    await client.from('content_items').delete().in('id', seededContentIds);
  }
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-3 + Inv-17 — seven-stage topology + per-stage counters in pipeline_runs',
  () => {
    it(
      'pipeline_runs.result.stage_counts contains all seven canonical stages with nonneg int values',
      async () => {
        const client = await createLiveServiceClient();

        // Poll for the pipeline_runs row corresponding to the fixture drop.
        const deadline = Date.now() + POLL_TIMEOUT_MS;
        let stageCounts: Record<string, unknown> | null = null;
        let pipelineRunId: string | null = null;

        while (Date.now() < deadline) {
          const { data: items } = await client
            .from('content_items')
            .select('id, op_id')
            .ilike('title', `${TEST_PREFIX}%`)
            .limit(1);

          if (items && items.length > 0 && items[0]!.op_id) {
            const opId = items[0]!.op_id as string;
            seededContentIds.push(items[0]!.id as string);
            const { data: runs } = await client
              .from('pipeline_runs')
              .select('id, result, status')
              .eq('op_id', opId)
              .eq('status', 'succeeded')
              .limit(1);

            if (runs && runs.length > 0) {
              pipelineRunId = runs[0]!.id as string;
              seededRunIds.push(pipelineRunId);
              const result = runs[0]!.result as Record<string, unknown> | null;
              stageCounts = (result?.stage_counts ?? null) as Record<
                string,
                unknown
              > | null;
              break;
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }

        expect(pipelineRunId).not.toBeNull();
        expect(stageCounts).not.toBeNull();

        // Inv-17 verifiability: all seven canonical stages MUST be present.
        // A missing stage proves partial-payload (broken contract); a row
        // with stage_counts === null proves the webhook bridge never landed
        // the success rollup (broken Inv-16).
        for (const stage of CANONICAL_STAGES) {
          expect(stageCounts).toHaveProperty(stage);
          const count = stageCounts![stage];
          expect(typeof count).toBe('number');
          expect(count).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(count)).toBe(true);
        }
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it('content_items.embedding is non-null when status is succeeded (Inv-3 embedding-stage verifiability)', async () => {
      const client = await createLiveServiceClient();

      const { data, error } = await client
        .from('content_items')
        .select('id, embedding')
        .ilike('title', `${TEST_PREFIX}%`)
        .limit(1);

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.length).toBeGreaterThan(0);

      // Per Inv-3 verifiability: "a run that completes MUST have written
      // embeddings to content_items.embedding". Null embedding on a row
      // with no matching failure row proves the embedding stage was
      // skipped or silently failed.
      const embedding = data![0]!.embedding;
      expect(embedding).not.toBeNull();
    }, 30_000);
  },
);
