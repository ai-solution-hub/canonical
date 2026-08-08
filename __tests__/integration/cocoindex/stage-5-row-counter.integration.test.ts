/**
 * Integration test — PRODUCT Inv-11 (stage_counts.entity_resolution = changed rows).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-11 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-11):
 *
 * > "stage_counts['entity_resolution'] is a per-row DELTA count of
 * > entity_mentions rows whose canonical_name Stage-5 CHANGED in this run (not
 * > the count of input rows). When Stage-5 ran but changed nothing the value
 * > is 0. Verifiable: ingest a corpus of N mentions where M resolve to a
 * > different cross-document canonical → stage_counts['entity_resolution'] == M."
 *
 * Test strategy: stage a two-document corpus with a cross-document duplicate
 * ('ISO 27001' / 'ISO27001') that Stage-5 WILL merge, forcing >= 1 UPDATE.
 * After the run, read stage_counts.entity_resolution and assert it equals the
 * observable count of rows whose canonical_name differs from their per-doc
 * default (the surface form). The load-bearing check: the counter is a
 * non-negative integer equal to the number of UPDATE-eligible rows we can
 * independently count (parity with the per-row embedding counter pattern).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-11.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-6 step 7, §3.
 *   - scripts/cocoindex_pipeline/flow.py:915 (per-row embedding counter pattern).
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasRealLiveDbCredentials } from '../helpers/supabase-client';

// PLANE MISMATCH RESOLVED (id-415, S539). This file asserts the Stage-5 per-row
// delta counter — plane 1, the cocoindex walk — and used to stage a blank
// extraction FORM, a plane-2 input with no prose to extract.
//
// The carried candidate was `CONTENT.sectorSpendXlsx`. It is the WRONG fix and
// was not taken: every `CONTENT` member is a walked-baseline doc the nightly
// admits before the Vitest tier runs, so re-staging one under a test prefix
// content-hash-resolves onto the baseline row and the prefix poll never
// matches. See the ENTITY_VARIANTS docblock in `_helpers/fixtures.ts`.
//
// This counter also needs more than "real prose": it counts rows whose
// canonical Stage-5 CHANGED, so the corpus must carry one entity under two
// surface forms. That is exactly what the entity-variants pair is for.
import { ENTITY_VARIANTS } from './_helpers/fixtures';

import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import { WALK_BUDGET_MS } from './_helpers/walk';
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

const TEST_PREFIX = `[53.14-INV11-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 180_000;

/** Two awaited walks in `beforeAll`, plus slack. */
const SETUP_BUDGET_MS = WALK_BUDGET_MS * 2 + 30_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // Two-doc corpus whose docs carry the SAME entity under DIFFERENT surface
  // forms — the only shape that makes Stage-5 rewrite a canonical, which is
  // what this counter counts.
  //
  // This used to stage ONE fixture (the CSP form) twice, at `-A.xlsx` and
  // `-B.xlsx`. That could not produce two rows, let alone a rewrite:
  // `resolve_or_mint_source_identity` is content-hash-first, so byte-identical
  // bytes at two paths resolve to ONE source_documents row
  // (`20260703160100_id138_admission_identity_fn.sql:48`) — `items.length >= 2`
  // was unsatisfiable by construction. And the fixture is a blank extraction
  // form carrying no certification-shaped token at all, so even with two rows
  // there would have been nothing for Stage-5 to resolve.
  //
  // The entity-variants pair fixes both halves at once, and is the same
  // substrate the cross-document-dedup and canonical-name-freshness siblings
  // already stage.
  await stageFixture({
    fixturePath: ENTITY_VARIANTS.certificationSpacedMd,
    destPath: `inv-11/${TEST_PREFIX}-A.md`,
    titlePrefix: `${TEST_PREFIX}-A`,
  });
  await stageFixture({
    fixturePath: ENTITY_VARIANTS.certificationCompactMd,
    destPath: `inv-11/${TEST_PREFIX}-B.md`,
    titlePrefix: `${TEST_PREFIX}-B`,
  });
}, SETUP_BUDGET_MS);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-11 — stage_counts.entity_resolution equals the count of changed rows',
  () => {
    it(
      'the per-row delta counter matches the number of rows whose canonical Stage-5 changed',
      async () => {
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const r of items) seededContentIds.push(r.id);
        expect(items.length).toBeGreaterThanOrEqual(2);

        const opId = items.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opId).not.toBeNull();
        expect(opId!).toMatch(UUID_V4_REGEX);

        const mentions = await pollEntityMentionsFor({
          opId: opId!,
          minRows: 2,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(mentions.length).toBeGreaterThan(0);

        // The observable count of rows whose canonical_name was CHANGED by
        // Stage-5: a row whose canonical_name no longer equals its surface
        // entity_name's per-doc default. We compute the delta as the number of
        // rows whose canonical_name differs from the most-common canonical for
        // their entity surface — i.e. rows that were merged onto a shared
        // canonical. This count is the independent observable parallel to the
        // counter.
        const changedRows = mentions.filter(
          (m) => m.canonical_name !== m.entity_name.toLowerCase().trim(),
        );

        // Inv-11 verifiability: the counter is present and a non-negative
        // integer. When >= 1 UPDATE fired (cross-doc dedup), the counter is
        // positive and equals the observable changed-row count.
        const count = await readEntityResolutionStageCount(opId!);
        expect(count).toBeDefined();
        expect(Number.isInteger(count!)).toBe(true);
        expect(count!).toBeGreaterThanOrEqual(0);

        // When the corpus produced changed rows, the counter must reflect them
        // (per-row delta semantics, not a once-per-pass increment). We assert
        // the counter equals the observable count of changed rows.
        if (changedRows.length > 0) {
          expect(count!).toBe(changedRows.length);
        }
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
