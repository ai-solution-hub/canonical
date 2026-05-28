/**
 * Integration test — PRODUCT Inv-21 (single-workspace scoping; no cross-tenant merge).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-21 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-21 + TECH §P-14):
 *
 * > "Stage-5 resolution is scoped to a single workspace boundary at v1;
 * > cross-workspace entity merging is OUT. Verifiable: when the corpus contains
 * > 'ISO 27001' in workspace W1 and 'ISO27001' in workspace W2, the two rows DO
 * > NOT resolve to a shared canonical — each workspace's Stage-5 pass operates
 * > on its own entity_mentions subset (each pipeline invocation runs over one
 * > COCOINDEX_SOURCE_PATH = one workspace, so a run never reads another
 * > workspace's rows: no rows from a different workspace share the run's op_id)."
 *
 * Test strategy: stage two SEPARATE runs (run W1, run W2), each a distinct
 * pipeline invocation with an overlapping entity surface ('ISO 27001' vs
 * 'ISO27001'). After both complete, assert the W1 rows and W2 rows do NOT
 * share a canonical_name — the two runs' op_ids differ, so neither Stage-5
 * pass read the other's rows (workspace isolation by op_id scoping).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-21.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-14, §3.
 *   - docs/reference/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasRealLiveDbCredentials } from '../helpers/supabase-client';
import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import { pollEntityMentionsFor } from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const W1_PREFIX = `[53.14-INV21-W1-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const W2_PREFIX = `[53.14-INV21-W2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

const FIXTURE_PATH =
  'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx';

const VARIANT_W1 = 'ISO 27001';
const VARIANT_W2 = 'ISO27001';

beforeAll(async () => {
  if (!ENABLED) return;
  // W1 run: corpus for workspace 1.
  await stageFixture({
    fixturePath: FIXTURE_PATH,
    destPath: `inv-21-w1/${W1_PREFIX}.xlsx`,
    titlePrefix: W1_PREFIX,
  });
  // W2 run: a SEPARATE pipeline invocation for workspace 2 (distinct
  // source-path → distinct op_id → isolated Stage-5 subset).
  await stageFixture({
    fixturePath: FIXTURE_PATH,
    destPath: `inv-21-w2/${W2_PREFIX}.xlsx`,
    titlePrefix: W2_PREFIX,
  });
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: W1_PREFIX, contentIds: seededContentIds });
  await dropFixture({ titlePrefix: W2_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-21 — Stage-5 does not merge entities across workspace boundaries',
  () => {
    it(
      'W1 and W2 surface variants of the same entity do NOT share a canonical_name',
      async () => {
        // Both runs land.
        const itemsW1 = await pollContentItemsFor(W1_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of itemsW1) seededContentIds.push(r.id);
        const opIdW1 = itemsW1.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opIdW1).not.toBeNull();

        const itemsW2 = await pollContentItemsFor(W2_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of itemsW2) seededContentIds.push(r.id);
        const opIdW2 = itemsW2.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opIdW2).not.toBeNull();

        // Distinct runs → distinct op_ids (the isolation forcing function).
        expect(opIdW2).not.toBe(opIdW1);

        const mentionsW1 = await pollEntityMentionsFor({
          opId: opIdW1!,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const mentionsW2 = await pollEntityMentionsFor({
          opId: opIdW2!,
          timeoutMs: POLL_TIMEOUT_MS,
        });

        const rowW1 = mentionsW1.find((m) => m.entity_name === VARIANT_W1);
        const rowW2 = mentionsW2.find((m) => m.entity_name === VARIANT_W2);
        expect(rowW1, `expected W1 mention '${VARIANT_W1}'`).toBeDefined();
        expect(rowW2, `expected W2 mention '${VARIANT_W2}'`).toBeDefined();

        // Inv-21 verifiability: the two workspaces' surface variants do NOT
        // resolve to a shared canonical_name — each Stage-5 pass operated only
        // on its own run's op_id-scoped rows, so cross-workspace merge never
        // happened. (Contrast Inv-3, where the SAME run merges them.)
        expect(rowW1!.canonical_name).not.toBe(rowW2!.canonical_name);
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
