/**
 * Integration test — PRODUCT Inv-20 (unresolved mentions retain per-doc canonical).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-20 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-20):
 *
 * > "When resolve_entities finds no cross-document match within max_distance
 * > for a per-document canonical, the row's canonical_name STAYS at the
 * > per-document value. Stage-5 issues NO UPDATE for that row; op_id is
 * > preserved. The row is NOT counted in stage_counts['entity_resolution']'s
 * > delta. Verifiable: ingest a corpus containing a UNIQUE entity name with no
 * > near-matches; the row's canonical_name equals the per-document default and
 * > the counter does not include it."
 *
 * Test strategy: stage a fixture; identify a row whose entity is unique within
 * the run (no near-match); assert its canonical_name equals the per-document
 * default (the canonicalise output — lowercase + strip of the surface form)
 * and that it was NOT changed by Stage-5 (canonical == per-doc default).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-20.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-6 step 5, §P-14, §3.
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

const TEST_PREFIX = `[53.14-INV20-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-20/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 30_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
}, 30_000);

/**
 * The per-document canonicalise default for a surface form: lowercase + strip
 * (the deterministic transform Inv-4 specifies; entity_type-aware
 * normalisation may extend it, but lowercase+strip is the floor). A row whose
 * canonical_name equals this for its entity_name was NOT changed by Stage-5.
 */
function perDocDefault(entityName: string): string {
  return entityName.toLowerCase().trim();
}

describe.skipIf(!ENABLED)(
  'Inv-20 — unresolved mentions retain the per-document canonical',
  () => {
    it(
      'a unique entity (no near-match) keeps its per-document canonical and is uncounted',
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

        // Identify rows whose entity_name is UNIQUE within the run (appears
        // exactly once) — these have no in-corpus near-match candidate, so
        // Stage-5 leaves them at the per-document default (Inv-20).
        const nameCounts = new Map<string, number>();
        for (const m of mentions) {
          nameCounts.set(
            m.entity_name,
            (nameCounts.get(m.entity_name) ?? 0) + 1,
          );
        }
        const uniqueRows = mentions.filter(
          (m) => nameCounts.get(m.entity_name) === 1,
        );

        // The corpus is expected to contain at least one unique entity.
        expect(
          uniqueRows.length,
          'expected at least one unique entity mention for the Inv-20 check',
        ).toBeGreaterThan(0);

        // Inv-20 verifiability: each unique row's canonical_name equals its
        // per-document default (Stage-5 issued NO UPDATE — the row resolved to
        // itself, so canonical_name stayed at the per-doc value).
        for (const m of uniqueRows) {
          expect(m.canonical_name).toBe(perDocDefault(m.entity_name));
        }

        // Inv-20 verifiability part 2 (PRODUCT.md Inv-20 + TECH.md §P-14): the
        // unique/unresolved rows are NOT counted in
        // stage_counts['entity_resolution']. This single-document fixture
        // produces no cross-document near-matches, so Stage-5 performs no
        // UPDATEs and the post-pass counter MUST stay 0. Extract the run's
        // op_id from the staged items (mirrors stage-5-attach-point /
        // op-id-scoping), then read the persisted counter for that op_id.
        const opId = items.find((r) => r.op_id !== null)?.op_id ?? null;
        expect(opId).not.toBeNull();
        expect(opId!).toMatch(UUID_V4_REGEX);

        const stageCount = await readEntityResolutionStageCount(opId!);
        expect(stageCount).toBe(0);
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
