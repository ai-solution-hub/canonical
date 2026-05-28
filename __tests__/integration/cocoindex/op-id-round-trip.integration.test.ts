/**
 * Integration test — PRODUCT Inv-6 (op_id round-trips to pipeline_runs).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-6 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-6):
 *
 * > "entity_mentions has an op_id uuid NULL column populated by ingest_file's
 * > declare_row. Given any op_id extracted from an entity_mentions row,
 * > `SELECT * FROM pipeline_runs WHERE op_id = $value` returns EXACTLY one
 * > row whose op_id matches."
 *
 * Test strategy: stage one fixture; poll its entity_mentions; for each
 * distinct op_id on those rows, assert the round-trip via assertOpIdRoundTrip
 * (exactly one pipeline_runs row). This mirrors the op-id-stamping test's
 * Inv-12 round-trip half but for the entity_mentions table specifically.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-6.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-4, §P-9, §3.
 *   - docs/reference/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasRealLiveDbCredentials } from '../helpers/supabase-client';
import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import {
  assertOpIdRoundTrip,
  pollEntityMentionsFor,
  UUID_V4_REGEX,
} from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[53.14-INV06-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-6/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-6 — entity_mentions.op_id round-trips to exactly one pipeline_runs row',
  () => {
    it(
      'every distinct entity_mentions.op_id resolves to exactly one pipeline_runs row',
      async () => {
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of items) seededContentIds.push(r.id);
        expect(items.length).toBeGreaterThan(0);

        const mentions = await pollEntityMentionsFor({
          titlePrefix: TEST_PREFIX,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(mentions.length).toBeGreaterThan(0);

        // Every entity_mentions row carries a non-NULL, v4 op_id.
        const opIds = new Set<string>();
        for (const m of mentions) {
          expect(m.op_id).not.toBeNull();
          expect(m.op_id!).toMatch(UUID_V4_REGEX);
          opIds.add(m.op_id!);
        }

        // Inv-6 verifiability: each distinct op_id round-trips to EXACTLY one
        // pipeline_runs row (assertOpIdRoundTrip enforces the count + shape).
        for (const opId of opIds) {
          const runId = await assertOpIdRoundTrip(opId);
          expect(runId).toMatch(UUID_V4_REGEX);
        }
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
