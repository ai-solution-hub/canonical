/**
 * Integration test — PRODUCT Inv-12 + Inv-13 (Stage-5 failure is
 * non-destructive; webhook surfaces the outcome).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 * Subtask {53.15} TIGHTENED this file: the errorClass assertion below is now
 * LOAD-BEARING — it asserts the exact `entity_resolution_failed` class that
 * the wrap-at-attach-site `_EntityResolutionStageError` (flow.py) now routes
 * every Stage-5 escape to (see the assertion comment).
 *
 * Inv-12 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-12):
 *
 * > "When a Stage-5 substep raises, the run records status='failed' AND the
 * > per-document canonical_name values written by the per-item phase REMAIN in
 * > place. Stage-5 failure does NOT delete or null-out per-item writes. The
 * > rows retain their per-document canonical_name and their op_id."
 *
 * Inv-13 statement (paraphrased): "the flow-end webhook payload includes
 * stage_counts['entity_resolution'] and, on failure, an errorClass."
 *
 * Failure-injection mechanism (config-only — NO prod-code hook; see
 * test-helpers.ts:injectStage5Failure docblock): the staged fixture's run is
 * configured with the embedding provider credential cleared, so
 * KhEntityEmbedder.embed() raises litellm.exceptions.AuthenticationError from
 * inside cocoindex.ops.entity_resolution.resolve_entities — a real exception
 * surfacing through _run_stage_5_resolution to flow.py's failure routing.
 *
 * Underlying provider exceptions the {53.15} wrap subsumes (both now map to
 * the single canonical class 'entity_resolution_failed' via stage context):
 *   - failMode 'embedder'      → litellm.exceptions.AuthenticationError
 *     (bare: `None` → unclassified; type-prefix cannot catch it).
 *   - failMode 'pair_resolver' → anthropic.AuthenticationError
 *     (bare: MISCLASSIFIED as extraction_provider_unavailable — an
 *     anthropic.APIError subclass, type-indistinguishable from Stage-3).
 * {53.15} resolves both by wrapping the Stage-5 attach site in
 * `_EntityResolutionStageError`, classified ahead of the anthropic branch.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-12, Inv-13.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-10, §3.
 *   - scripts/cocoindex_pipeline/flow.py:162-168 (_PIPELINE_ERROR_CLASSES),
 *     :188 (_classify_stage_exception).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLiveServiceClient,
  hasRealLiveDbCredentials,
} from '../helpers/supabase-client';
import { dropFixture, pollContentItemsFor } from './_helpers/fixture-staging';
import {
  injectStage5Failure,
  pollEntityMentionsFor,
  STAGE5_FAILURE_EXCEPTION_CLASSES,
} from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[53.14-INV12-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // Stage a fixture whose Stage-5 pass is configured to fail (embedder auth
  // failure — config-only, no prod-code hook). The per-item phase still writes
  // entity_mentions rows (Stage-5 fails AFTER they are committed).
  await injectStage5Failure({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-12/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
    failMode: 'embedder',
  });
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-12/13 — Stage-5 failure is non-destructive + webhook surfaces the outcome',
  () => {
    it(
      'per-item rows survive with their per-doc canonical and op_id after a Stage-5 failure',
      async () => {
        // The per-item phase committed entity_mentions BEFORE Stage-5 fired, so
        // they are observable even though the run failed.
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of items) seededContentIds.push(r.id);
        expect(items.length).toBeGreaterThan(0);

        const opId = items.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opId).not.toBeNull();

        const mentions = await pollEntityMentionsFor({
          opId: opId!,
          timeoutMs: POLL_TIMEOUT_MS,
        });

        // Inv-12 verifiability: the per-item rows are intact — non-empty
        // canonical_name (the per-doc default, NOT nulled out) and op_id
        // preserved. The Stage-5 UPDATE pass failed, so canonical_name stayed
        // at the per-document value.
        expect(mentions.length).toBeGreaterThan(0);
        for (const m of mentions) {
          expect(m.canonical_name).toBeTruthy();
          expect(m.op_id).toBe(opId);
        }
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it(
      "the run records status='failed' and the webhook/result carries errorClass + stageCounts",
      async () => {
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const opId = items.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opId).not.toBeNull();

        // Poll pipeline_runs for the run reaching a terminal 'failed' status.
        const run = await pollPipelineRunStatus(opId!, 'failed');
        expect(
          run,
          "expected a pipeline_runs row in status='failed'",
        ).not.toBeNull();
        expect(run!.status).toBe('failed');

        const result = (run!.result as Record<string, unknown> | null) ?? {};

        // Inv-13: stage_counts is present (entity_resolution key surfaced — 0
        // when the failure was at the embedder/preload step before any UPDATE,
        // positive if partial updates fired).
        const stageCounts =
          (result.stage_counts as Record<string, unknown> | undefined) ?? {};
        expect('entity_resolution' in stageCounts).toBe(true);

        // Inv-13: the errorClass is now LOAD-BEARING post-{53.15}. The
        // wrap-at-attach-site `_EntityResolutionStageError` (flow.py) routes
        // ANY Stage-5 escape — embedder litellm.AuthenticationError OR
        // pair_resolver anthropic.AuthenticationError — to the canonical
        // 'entity_resolution_failed' class, regardless of the underlying
        // provider exception type. This assertion was deliberately TOLERANT
        // before {53.15}; it is now tightened to the exact contract.
        const errorClass = (result.error_class as string | undefined) ?? null;
        expect(
          errorClass,
          "expected pipeline_runs.result.error_class === 'entity_resolution_failed' " +
            'after {53.15} wired the wrap-at-attach-site stage classification',
        ).toBe('entity_resolution_failed');

        // The STAGE5_FAILURE_EXCEPTION_CLASSES export documents the underlying
        // provider-exception surface the wrap subsumes (both failModes now map
        // to the single canonical class asserted above).
        expect(STAGE5_FAILURE_EXCEPTION_CLASSES.embedder.module).toBe(
          'litellm.exceptions',
        );
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);

/**
 * Poll pipeline_runs by op_id until the row reaches `targetStatus`, or timeout.
 * Returns the row, or null on timeout.
 */
async function pollPipelineRunStatus(
  opId: string,
  targetStatus: string,
): Promise<Record<string, unknown> | null> {
  const client = await createLiveServiceClient();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data: run } = await client
      .from('pipeline_runs')
      .select('id, op_id, status, error_message, result')
      .eq('op_id', opId)
      .maybeSingle();
    if (run && run.status === targetStatus) {
      return run as Record<string, unknown>;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return null;
}
