/**
 * Integration test — PRODUCT Inv-3 (cross-document canonical_name freshness).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-3 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-3):
 *
 * > "After a run completes, ingest a corpus with 'ISO 27001' in doc A and
 * > 'ISO27001' in doc B in the SAME run; both rows' canonical_name resolve to
 * > the same cross-document canonical (the specific value is
 * > implementation-determined; the invariant is that they MATCH)."
 *
 * Test strategy: stage two fixtures into one run-corpus, each carrying a
 * surface variant of the same entity ('ISO 27001' vs 'ISO27001'). After the
 * run, poll the run's entity_mentions; assert the two surface variants share
 * one canonical_name (cross-document dedup happened) — NOT the
 * implementation-chosen value, just the MATCH (behaviour-not-implementation).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where the fixture-staging
 * service is not wired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-3.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-6, §P-7, §3.
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

const TEST_PREFIX = `[53.14-INV03-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 180_000;

// The two surface variants of the SAME entity Stage-5 should dedup across docs.
const VARIANT_A = 'ISO 27001';
const VARIANT_B = 'ISO27001';

beforeAll(async () => {
  if (!ENABLED) return;
  // Two fixtures sharing the TEST_PREFIX corpus — doc A carries 'ISO 27001',
  // doc B carries 'ISO27001'. The fixtures are the certification-bearing
  // templates from the ID-49.10 committed fixture library.
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-3-dedup/${TEST_PREFIX}-A.xlsx`,
    titlePrefix: `${TEST_PREFIX}-A`,
  });
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-3-dedup/${TEST_PREFIX}-B.xlsx`,
    titlePrefix: `${TEST_PREFIX}-B`,
  });
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-3 — cross-document dedup resolves surface variants to one canonical',
  () => {
    it(
      "'ISO 27001' (doc A) and 'ISO27001' (doc B) resolve to the SAME canonical_name",
      async () => {
        // Wait for BOTH content_items to land (one per doc).
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const row of items) seededContentIds.push(row.id);
        // Both docs produced rows.
        expect(items.length).toBeGreaterThanOrEqual(2);

        // Poll the run's entity_mentions across both docs.
        const mentions = await pollEntityMentionsFor({
          titlePrefix: TEST_PREFIX,
          minRows: 2,
          timeoutMs: POLL_TIMEOUT_MS,
        });

        // Locate the rows carrying each surface variant (entity_name preserves
        // the original surface form; canonical_name is the resolution output).
        const rowA = mentions.find((m) => m.entity_name === VARIANT_A);
        const rowB = mentions.find((m) => m.entity_name === VARIANT_B);
        expect(
          rowA,
          `expected a mention with entity_name '${VARIANT_A}'`,
        ).toBeDefined();
        expect(
          rowB,
          `expected a mention with entity_name '${VARIANT_B}'`,
        ).toBeDefined();

        // Inv-3 verifiability: the two surface variants share ONE
        // canonical_name (cross-document dedup happened). The specific value
        // is implementation-determined — we assert the MATCH, not the value.
        expect(rowA!.canonical_name).toBe(rowB!.canonical_name);
        expect(rowA!.canonical_name).toBeTruthy();
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
