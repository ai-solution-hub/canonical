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
 *   - docs/reference/testing/test-philosophy.md (behaviour-not-implementation).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasRealLiveDbCredentials } from '../helpers/supabase-client';

// id-415 (S543): repointed off the shared blank CSP form onto this spec's OWN
// per-test CONTENT document. Two defects ended together here. The form was a
// plane-2 input carrying no prose, so a plane-1 assertion over it was measuring
// nothing; and TEN specs staged that one file, which content-hash-first identity
// collapsed onto a single source_documents row — storage_path frozen by the first
// stager, filename overwritten by the last, later stagings memo-SKIPped entirely.
// Nightly run 31271744240 failed five of the ten out of that shared row. DR-133
// as amended: one distinct-bytes document, one consuming spec.
import { PER_TEST_CONTENT } from './_helpers/fixtures';

import {
  dropFixture,
  pollContentItemsFor,
  stageFixture,
} from './_helpers/fixture-staging';
import { WALK_BUDGET_MS } from './_helpers/walk';
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

// The alias SOURCE is this fixture's own certification token; the alias TARGET
// is a value Stage-5 can only produce by consulting the preloaded map.
//
// That distinction is the assertion. Until S543 the target was `'iso 27001'` —
// the lowercase of the source, which IS the per-document canonical
// `canonicalise_entity_name` produces unaided. The row therefore carried the
// expected value whether or not the alias map was preloaded at all, so the test
// passed identically with the mechanism under test removed. A distinctive target
// is what makes a pass mean something.
const ALIAS_FROM = 'AAB 27019';
const ALIAS_TO = 'aab-27019-alias-target';

const POLL_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  if (!ENABLED) return;
  // Seed the active alias BEFORE staging so the preload picks it up.
  // No provenance override: the helper's 'client' default is the only
  // legal test bucket (`entity_aliases_provenance_check` allows just
  // 'core'/'client'/'recommended'); suite scoping rides on the unique
  // ALIAS_TO value + id-scoped cleanup, not provenance.
  seededAliases = await seedAliasMap([
    {
      alias: ALIAS_FROM,
      canonical: ALIAS_TO,
    },
  ]);
  await stageFixture({
    fixturePath: PER_TEST_CONTENT.inv10LegacyAliasPreloadMd,
    destPath: `inv-10/${TEST_PREFIX}.md`,
    titlePrefix: TEST_PREFIX,
  });
}, WALK_BUDGET_MS + 30_000);

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
