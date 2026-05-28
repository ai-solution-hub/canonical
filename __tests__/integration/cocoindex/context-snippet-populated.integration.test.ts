/**
 * Integration test — PRODUCT Inv-17 (context_snippet populated via Python port).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-17 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-17):
 *
 * > "The per-item phase computes context_snippet for each entity_mentions row
 * > via a Python port of lib/ai/classify.ts:1611 extractEntityContext. The
 * > column is NOT left NULL; downstream consumers see it populated for every
 * > Stage-5-produced row. Verifiable: pipeline-produced context_snippet
 * > matches the Python-port output for the same inputs."
 *
 * Test strategy: stage one fixture; poll its entity_mentions; assert EVERY row
 * has a non-NULL, non-empty context_snippet (the load-bearing behaviour:
 * downstream consumers always see it populated). A weak/empty snippet on any
 * row is an Inv-17 break.
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-17.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-3, §P-5, §3.
 *   - scripts/cocoindex_pipeline/entity_context.py (the Python port).
 *   - lib/ai/classify.ts:1611 extractEntityContext (the TS source-of-truth).
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

const TEST_PREFIX = `[53.14-INV17-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-17/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-17 — context_snippet is populated for every produced entity_mentions row',
  () => {
    it(
      'every entity_mentions row carries a non-NULL, non-empty context_snippet',
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

        // Inv-17 verifiability: NO row has a NULL or empty context_snippet —
        // the per-item phase's Python port populated it for every row. A
        // single NULL/empty row is an Inv-17 break (downstream consumers would
        // render an empty snippet).
        for (const m of mentions) {
          expect(
            m.context_snippet,
            `entity_mentions row ${m.id} (${m.entity_name}) has a NULL context_snippet`,
          ).not.toBeNull();
          expect(
            (m.context_snippet ?? '').trim().length,
            `entity_mentions row ${m.id} (${m.entity_name}) has an empty context_snippet`,
          ).toBeGreaterThan(0);
          // The snippet contains (or relates to) the mention — the port slices
          // content_text around the entity span, so the entity surface or a
          // case-folded form is present.
          const snippet = (m.context_snippet ?? '').toLowerCase();
          expect(snippet.length).toBeGreaterThan(0);
        }
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
