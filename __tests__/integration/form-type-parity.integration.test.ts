/**
 * `form_type` triple-source parity — against the LIVE table (id-417 A4).
 *
 * The defect this closes: `__tests__/lib/ontology/form-type-parity.test.ts`
 * calls itself a "triple-source lockstep" and names the live `form_types`
 * Postgres table as the source of truth, but only ever compares the frozen
 * fixture to the generated snapshot. Both are files in this repo, both are
 * updated by hand or by the same generator, and neither is the DB — so the
 * guard stayed green through a real divergence.
 *
 * The divergence: `20260712065000_id145_bi8_retire_bid_creation_label.sql`
 * reclassified `bid` -> `itt` and then DELETEd `form_types.key='bid'` under a
 * guard that fired only once zero rows referenced it. `bid` survived in the
 * fixture and the snapshot for three weeks. Because
 * `scripts/cocoindex_pipeline` validates `FormMetadata.form_type` against the
 * SNAPSHOT, Python went on accepting a value that three live FKs reject at
 * insert:
 *   - form_instances.form_type            -> form_types(key)
 *   - form_requirement_templates.template_type -> form_types(key) ON DELETE RESTRICT
 *   - question_matches.question_kind      -> form_types(key) ON DELETE RESTRICT
 *
 * A file-to-file comparison cannot catch that class of drift by construction.
 * This test pins both files to the DB, so the next CV row added or removed by
 * migration fails CI until `bun run sync:taxonomy` and the fixture catch up.
 *
 * Reads `api.form_types` (the Data-API view over `public.form_types`) because
 * that is the surface the app itself consumes — see `lib/supabase/schema.ts`.
 *
 * Prerequisites:
 *   - NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY pointing at the
 *     Platform staging branch.
 *
 * Run via: `bun run test:integration -- form-type-parity`
 *   (NOT picked up by `bun run test`.)
 *
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';

import { serviceClient } from './helpers/service-client';
import { findProjectRoot } from './helpers/find-project-root';

const PROJECT_ROOT = findProjectRoot();
const SNAPSHOT_PATH = join(
  PROJECT_ROOT,
  'scripts/tests/fixtures/taxonomy_snapshot.json',
);
const BASELINES_PATH = join(
  PROJECT_ROOT,
  '__tests__/fixtures/ontology/ontology-cv-baselines.json',
);

function snapshotKeys(): string[] {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as {
    form_types?: Array<{ key: string }>;
  };
  return (snapshot.form_types ?? []).map((r) => r.key).sort();
}

function fixtureKeys(): string[] {
  const fixture = JSON.parse(readFileSync(BASELINES_PATH, 'utf8')) as {
    cvs: Array<{ cv_name: string; baseline_values?: Array<{ key: string }> }>;
  };
  const cv = fixture.cvs.find((c) => c.cv_name === 'form_type');
  if (!cv)
    throw new Error('ontology-cv-baselines.json has no cv_name=form_type');
  return (cv.baseline_values ?? []).map((bv) => bv.key).sort();
}

const REMEDIATION =
  'Regenerate the snapshot with `bun run sync:taxonomy` and update ' +
  '__tests__/fixtures/ontology/ontology-cv-baselines.json per its ' +
  '_meta.update_protocol (live CV register: private docs-site repo).';

describe('form_type parity — live table is the source of truth (id-417 A4)', () => {
  let liveKeys: string[] = [];

  beforeAll(async () => {
    const { data, error } = await serviceClient
      .from('form_types')
      .select('key');
    // A hard failure, not a skip: this suite exists precisely because the
    // file-only guard could not fail. Silently degrading to "no DB, no
    // assertion" would reintroduce the defect.
    expect(
      error,
      `Could not read form_types from the live DB: ${error?.message ?? ''}`,
    ).toBeNull();
    expect(data, 'form_types returned no rows').toBeTruthy();
    liveKeys = (data ?? []).map((r) => r.key as string).sort();
    expect(liveKeys.length).toBeGreaterThan(0);
  });

  it('taxonomy_snapshot.json:form_types matches the live form_types table', () => {
    const snap = snapshotKeys();
    expect(
      { inSnapshotOnly: snap.filter((k) => !liveKeys.includes(k)) },
      `taxonomy_snapshot.json lists form_type keys the live table does not ` +
        `have. The Python pipeline validates against this snapshot, so these ` +
        `values are accepted by extraction and then rejected by the ` +
        `form_types FKs at insert. ${REMEDIATION}`,
    ).toEqual({ inSnapshotOnly: [] });

    expect(
      { inLiveOnly: liveKeys.filter((k) => !snap.includes(k)) },
      `The live form_types table has keys the snapshot lacks, so the Python ` +
        `pipeline will reject values the DB accepts. ${REMEDIATION}`,
    ).toEqual({ inLiveOnly: [] });

    expect(snap).toEqual(liveKeys);
  });

  it('the frozen ontology CV baseline matches the live form_types table', () => {
    const fixture = fixtureKeys();
    expect(
      {
        inFixtureOnly: fixture.filter((k) => !liveKeys.includes(k)),
        inLiveOnly: liveKeys.filter((k) => !fixture.includes(k)),
      },
      `ontology-cv-baselines.json has drifted from the live CV. ${REMEDIATION}`,
    ).toEqual({ inFixtureOnly: [], inLiveOnly: [] });

    expect(fixture).toEqual(liveKeys);
  });

  it('does not carry the retired `bid` key in any of the three sources', () => {
    // Regression pin for the specific drift that motivated this file.
    // `bid` was reclassified to `itt` and deleted by
    // 20260712065000_id145_bi8_retire_bid_creation_label.sql.
    expect(liveKeys).not.toContain('bid');
    expect(snapshotKeys()).not.toContain('bid');
    expect(fixtureKeys()).not.toContain('bid');
  });
});
