/**
 * Integration test — PRODUCT Inv-4 + Inv-15 + Inv-16 (per-document
 * canonicalisation + schema-parity at declare_row).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Covers (per TECH §3 coverage matrix, three invariants in one file):
 *   - Inv-4: the per-item ingest_file body writes a deterministic per-document
 *     canonical_name at declare_row time BEFORE Stage-5 runs; re-ingesting a
 *     byte-identical corpus yields the same per-doc canonical.
 *   - Inv-15: entity_mentions.confidence == the Pydantic mention_confidence
 *     float clamped to [0.0, 1.0] (the field is mapped, not renamed).
 *   - Inv-16: source_span_start / source_span_end are stashed in the metadata
 *     jsonb (no dedicated columns).
 *
 * Inv-4 statement (paraphrased): "A run whose Stage-5 phase fails mid-pass
 * leaves every per-item row in place with the per-document default canonical."
 * Here we assert the success-path corollary: every produced row carries a
 * non-empty canonical_name that is a deterministic function of the source.
 *
 * Test strategy: stage one fixture; poll its entity_mentions; assert each row
 * has (a) a non-empty canonical_name, (b) a confidence within [0,1] (or NULL,
 * the column default), (c) metadata.source_span_start / source_span_end
 * present as integers. Then re-stage the SAME bytes and assert canonical_name
 * is stable across the re-ingest (deterministic per-doc canonicalisation).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-4, Inv-15, Inv-16.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-2, §P-3, §3.
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
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

const TEST_PREFIX = `[53.14-INV04-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

const FIXTURE_PATH =
  'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx';

beforeAll(async () => {
  if (!ENABLED) return;
  await stageFixture({
    fixturePath: FIXTURE_PATH,
    destPath: `inv-4/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-4/15/16 — per-document canonicalisation + schema-parity at declare_row',
  () => {
    it(
      'every entity_mentions row carries a per-doc canonical, in-range confidence, and metadata source spans',
      async () => {
        const items = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const row of items) seededContentIds.push(row.id);
        expect(items.length).toBeGreaterThan(0);

        const mentions = await pollEntityMentionsFor({
          titlePrefix: TEST_PREFIX,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        expect(mentions.length).toBeGreaterThan(0);

        for (const m of mentions) {
          // Inv-4: per-document canonical is written (non-empty) at declare_row.
          expect(m.canonical_name).toBeTruthy();
          expect(typeof m.canonical_name).toBe('string');

          // Inv-15: confidence is the mention_confidence float clamped to
          // [0,1] (or NULL — the column default 1.0 may also surface). When
          // present it MUST be in range.
          if (m.confidence !== null) {
            expect(m.confidence).toBeGreaterThanOrEqual(0);
            expect(m.confidence).toBeLessThanOrEqual(1);
          }

          // Inv-16: source spans are stashed in the metadata jsonb (no
          // dedicated columns). When the LLM extracted spans, both keys are
          // present and integer-typed.
          const md = m.metadata ?? {};
          const hasStart = 'source_span_start' in md;
          const hasEnd = 'source_span_end' in md;
          // Spans travel as a pair: either both present or both absent.
          expect(hasStart).toBe(hasEnd);
          if (hasStart) {
            expect(Number.isInteger(md.source_span_start as number)).toBe(true);
            expect(Number.isInteger(md.source_span_end as number)).toBe(true);
          }
        }
      },
      POLL_TIMEOUT_MS + 30_000,
    );

    it(
      're-ingesting byte-identical bytes yields a stable per-document canonical_name (deterministic)',
      async () => {
        // Capture the canonical_name set from the first ingest.
        const firstPass = await pollEntityMentionsFor({
          titlePrefix: TEST_PREFIX,
          timeoutMs: POLL_TIMEOUT_MS,
        });
        const firstCanonicals = new Map(
          firstPass.map((m) => [m.entity_name, m.canonical_name]),
        );
        expect(firstCanonicals.size).toBeGreaterThan(0);

        // Re-stage the SAME bytes under a fresh dest path (same titlePrefix so
        // the poll picks both up). A memoised unchanged re-ingest does not
        // re-stamp rows; but the per-document canonicalisation is a pure
        // deterministic function, so any row produced carries the SAME
        // canonical for the SAME entity_name. We re-poll and assert stability.
        await stageFixture({
          fixturePath: FIXTURE_PATH,
          destPath: `inv-4/${TEST_PREFIX}-reingest.xlsx`,
          titlePrefix: TEST_PREFIX,
        });

        const secondItems = await pollContentItemsFor(TEST_PREFIX, {
          timeoutMs: POLL_TIMEOUT_MS,
        });
        for (const row of secondItems) {
          if (!seededContentIds.includes(row.id)) seededContentIds.push(row.id);
        }

        const secondPass = await pollEntityMentionsFor({
          titlePrefix: TEST_PREFIX,
          timeoutMs: POLL_TIMEOUT_MS,
          minRows: firstPass.length,
        });

        // Inv-4: deterministic per-doc canonicalisation — for every
        // entity_name seen in pass 1, every row with that entity_name in the
        // (now larger) set carries the SAME per-doc canonical.
        for (const m of secondPass) {
          const expected = firstCanonicals.get(m.entity_name);
          if (expected !== undefined) {
            expect(m.canonical_name).toBe(expected);
          }
        }
      },
      POLL_TIMEOUT_MS * 2 + 30_000,
    );
  },
);
