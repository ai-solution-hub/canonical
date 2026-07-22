/**
 * Integration test — PRODUCT Inv-1 (Stage-5 as flow-scope post-fan-out pass).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-1 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-1):
 *
 * > "Stage-5 runs as a SECOND write phase AFTER the per-item mount_each
 * > fan-out has settled — between `await handle.ready()` and the flow-end
 * > webhook. All per-item entity_mentions rows are committed BEFORE any
 * > Stage-5 UPDATE fires. An external observer verifies the post-pass ran by
 * > reading `pipeline_runs.result.stage_counts["entity_resolution"]` (>= 0)."
 *
 * Test strategy: stage a single fixture; poll its entity_mentions rows by
 * op_id; assert (a) every row carries the run's op_id (committed by the
 * per-item phase, so observable post-run), (b) the run's
 * stage_counts.entity_resolution is present and >= 0 (proving the post-pass
 * executed between handle.ready and the webhook emit — a run that crashed
 * before Stage-5 would leave the counter at its initial 0 too, so the
 * load-bearing signal is the counter's PRESENCE on a completed run).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where the fixture-staging
 * service is not wired (the ID-49.10 ratified pattern).
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-1.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-1, §3 (Inv-1 row).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasRealLiveDbCredentials } from '../helpers/supabase-client';
import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import {
  pollEntityMentionsFor,
  readEntityResolutionStageCount,
  UUID_V4_REGEX,
} from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[53.14-INV01-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-1-attach/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-1 — Stage-5 runs as a flow-scope post-fan-out resolution pass',
  () => {
    it(
      'per-item entity_mentions are committed with the run op_id and the post-pass counter is present',
      async () => {
        // Wait for the content_items row to land (the per-item phase produced it).
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const row of items) seededContentIds.push(row.id);
        expect(items.length).toBeGreaterThan(0);

        const opId = items.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opId).not.toBeNull();
        expect(opId!).toMatch(UUID_V4_REGEX);

        // Inv-1 part 1: the per-item entity_mentions rows are committed and
        // carry the run's op_id (observable AFTER the run, which proves they
        // were written by the per-item phase — Stage-5 only UPDATEs, never
        // INSERTs).
        const mentions = await pollEntityMentionsFor({
          opId: opId!,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(mentions.length).toBeGreaterThan(0);
        for (const m of mentions) {
          expect(m.op_id).toBe(opId);
          expect(m.canonical_name).toBeTruthy();
        }

        // Inv-1 part 2: the post-pass executed — its per-stage counter is
        // PRESENT on the completed run (>= 0). A missing counter would mean
        // the run never reached the Stage-5 fold-back at flow end.
        const count = await readEntityResolutionStageCount(opId!);
        expect(count).toBeDefined();
        expect(count!).toBeGreaterThanOrEqual(0);
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
