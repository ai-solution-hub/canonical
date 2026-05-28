/**
 * Integration test — PRODUCT Inv-10 (legacy entity_aliases preload).
 *
 * Subtask ID-53.14 (S277 — Stage-5 entity-resolution invariant coverage).
 *
 * Inv-10 statement (paraphrased from
 * `docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md` Inv-10):
 *
 * > "Stage-5 loads the active entity_aliases map at the start of its post-pass
 * > and applies it BEFORE resolve_entities runs, so cross-document outputs are
 * > consistent with resolveAlias(). When entity_aliases contains an active
 * > alias 'X' → 'Y', a run that resolves a corpus entity to 'X' writes 'Y' as
 * > the final canonical."
 *
 * Test strategy: seed an active entity_aliases row mapping the fixture's known
 * per-doc canonical to a distinctive aliased canonical; stage the fixture; poll
 * the run's entity_mentions; assert at least one row's canonical_name equals
 * the seeded aliased value (the preload mapped the per-doc canonical THROUGH
 * the alias before resolve_entities).
 *
 * Env-gate: COCOINDEX_STAGING_URL + COCOINDEX_FIXTURE_STAGING_URL +
 * COCOINDEX_SOURCE_PATH + live Supabase. Skip-clean where unwired.
 *
 * References:
 *   - docs/specs/id-53-stage-5-entity-resolution/PRODUCT.md Inv-10.
 *   - docs/specs/id-53-stage-5-entity-resolution/TECH.md §P-6 step 1+3, §3.
 *   - scripts/cocoindex_pipeline/stage_5.py:_preload_entity_aliases.
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
  cleanupAliasMap,
  pollEntityMentionsFor,
  seedAliasMap,
  type SeededAlias,
} from './test-helpers';

const HAS_STAGING_URL = Boolean(process.env.COCOINDEX_STAGING_URL);
const HAS_SOURCE_PATH = Boolean(process.env.COCOINDEX_SOURCE_PATH);
const HAS_FIXTURE_STAGING = Boolean(process.env.COCOINDEX_FIXTURE_STAGING_URL);
const HAS_LIVE_DB = hasRealLiveDbCredentials();

const ENABLED =
  HAS_STAGING_URL && HAS_SOURCE_PATH && HAS_FIXTURE_STAGING && HAS_LIVE_DB;

const TEST_PREFIX = `[53.14-INV10-${Date.now()}-${Math.random().toString(36).slice(2, 8)}]`;
const seededContentIds: string[] = [];
let seededAliases: SeededAlias[] = [];

// The fixture is known to mention 'ISO 27001', whose per-document canonical is
// 'iso 27001' (lowercase per the canonicalise function). We seed an alias that
// maps that per-doc canonical to a distinctive test value Stage-5 must honour.
const ALIAS_FROM = 'iso 27001';
const ALIAS_TO = `${TEST_PREFIX}-ISO-27001-aliased`;

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // Seed the active alias BEFORE staging so the preload picks it up.
  seededAliases = await seedAliasMap([
    {
      alias: ALIAS_FROM,
      canonical: ALIAS_TO,
      provenance: `id-53.14-inv10-${TEST_PREFIX}`,
    },
  ]);
  await stageFixture({
    fixturePath:
      'docs/testing/test-data/templates/csp-checklist/Cloud Security Principles Checklist V5_3.xlsx',
    destPath: `inv-10/${TEST_PREFIX}.xlsx`,
    titlePrefix: TEST_PREFIX,
  });
}, 60_000);

afterAll(async () => {
  if (!ENABLED) return;
  await dropFixture({ titlePrefix: TEST_PREFIX, contentIds: seededContentIds });
  await cleanupAliasMap(seededAliases.map((a) => a.id));
}, 30_000);

describe.skipIf(!ENABLED)(
  'Inv-10 — Stage-5 preloads the legacy entity_aliases map before resolve_entities',
  () => {
    it(
      'a corpus entity resolving to the aliased canonical writes the alias target',
      async () => {
        // The alias seed must have landed.
        expect(seededAliases.length).toBe(1);

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

        // Inv-10 verifiability: at least one row's canonical_name equals the
        // seeded alias TARGET — the preload mapped the per-doc canonical
        // through the alias before resolve_entities, so the final canonical
        // matches what resolveAlias() would return.
        const aliasedRow = mentions.find((m) => m.canonical_name === ALIAS_TO);
        expect(
          aliasedRow,
          `expected a mention canonicalised to '${ALIAS_TO}' via the seeded alias`,
        ).toBeDefined();
      },
      POLL_TIMEOUT_MS + 30_000,
    );
  },
);
