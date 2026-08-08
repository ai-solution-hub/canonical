#!/usr/bin/env bun
/**
 * id-400 — NM-8: per-run census READ GATE (DB half).
 *
 * HARNESS.md §4 (id-397, RATIFIED): a nightly run's census numbers are
 * readable only when (i) the sidecar log carries ZERO UniqueViolations
 * (checked by the workflow step alongside this script — the log lives
 * runner-side), (ii) the same-bytes population is green at the write path
 * (evidenced inside the Vitest verdict — chunking C-31 / idempotency), and
 * (iii) the STAGED-FIXTURE POPULATION MATCHES THE MANIFEST — this script.
 *
 * The manifest of record is `docs/reference/testing/corpus-manifest.json`
 * (id-406 / DR-118) — its `staging_mode: verify-driver` entries. It USED to be
 * verify_driver.py FIXTURE_SETS `templates`, mirrored here by hand; that mirror
 * is gone. verify_driver.py still holds the staging tuples (it does the
 * staging), but it is no longer the source of truth for WHICH fixtures are in
 * the set, and `__tests__/guards/corpus-manifest.test.ts` asserts the two
 * agree in both directions — so the three lists cannot drift apart.
 *
 * Each dest path must resolve to EXACTLY ONE source_documents row post-run.
 * Fewer ⇒ staging/walk loss; more ⇒ identity split (the F4 class). Exit 1
 * fails the gate.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import {
  loadCorpusManifest,
  verifyDriverDestPaths,
  walkedBaselineTargets,
} from '@/lib/corpus/fixture-manifest';
import { createLooseScriptClient } from '@/scripts/lib/supabase-script-client';

for (const envFile of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), envFile);
  if (existsSync(path)) {
    loadDotenv({ path, override: false });
  }
}

/**
 * The dest paths `scripts/cocoindex_pipeline/verify_driver.py`
 * FIXTURE_SETS['templates'] stages, sourced from the corpus fixture manifest
 * (id-406 / DR-118) rather than duplicated here.
 *
 * This used to be a hardcoded three-element array — and a hardcoded TypeScript
 * array named `DRIVER_MANIFEST_…` *was* the fixture manifest, just
 * un-externalised: no SHA, no `fixture_class`, no `staging_mode`, no declared
 * consumers. Against three bare strings a walk-loss failure reads only as
 * "2 failures"; against the manifest it is attributable — which fixture class
 * was expected to stage, and which consumers are now uncovered.
 *
 * Sourcing it from the manifest also means the census gate and
 * `__tests__/guards/corpus-manifest.test.ts` read the SAME file, so the two
 * lists can no longer drift apart. The manifest guard enforces that every
 * `verify-driver` entry declares a `verify_dest` in the flat `verify/<basename>`
 * scheme (`c64be60b`).
 */
const DRIVER_MANIFEST_DEST_PATHS = verifyDriverDestPaths(loadCorpusManifest());

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'census gate: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.',
  );
  process.exit(2);
}

const client = createLooseScriptClient(supabaseUrl, serviceRoleKey);

let failures = 0;
const counts: Record<string, number> = {};

async function assertExactlyOne(
  label: string,
  paths: string[],
  lossHint: string,
): Promise<void> {
  const filter = paths
    .flatMap((p) => [`storage_path.eq.${p}`, `logical_path.eq.${p}`])
    .join(',');
  const { data, error } = await client
    .from('source_documents')
    .select('id')
    .or(filter);
  if (error) {
    console.error(`census gate: query failed for ${label}: ${error.message}`);
    process.exit(2);
  }
  // Distinct ids: a document filed under BOTH its corpus path and its
  // verify_dest is ONE row matching two disjuncts, not two rows.
  const n = new Set((data ?? []).map((r) => r.id as string)).size;
  counts[label] = n;
  if (n !== 1) {
    failures += 1;
    console.error(
      `census gate FAIL: ${label} resolves to ${n} source_documents row(s), ` +
        `expected exactly 1 ${n === 0 ? lossHint : '(identity split — the F4 UniqueViolation class)'}`,
    );
  }
}

// (1) The verify-lane copies — the gate's original scope.
for (const destPath of DRIVER_MANIFEST_DEST_PATHS) {
  await assertExactlyOne(destPath, [destPath], '(staging/walk loss)');
}

// (2) id-412 AC-10, added S539: the WALKED BASELINE — the corpus this lane
// exists to walk. The gate checked 3 of 11 documents, all of them verify-lane
// copies, so a green gate said nothing about the Platform corpus. It missed a
// document that had been deleted twice and stayed missing for five days
// (synthetic-company-overview.md; the sweep's mutable-path predicate, fixed
// separately under S511 D1).
//
// Accepts EITHER the corpus path or the verify_dest: content-hash identity
// guarantees one row but does not determine which of a document's names was
// frozen as storage_path at mint, and since S527 the verify driver stages three
// of these into the verify lane too. Measured on staging: two landed under
// `content/`, one under `verify/`. Asserting the corpus path alone would report
// a false loss for that one.
for (const target of walkedBaselineTargets(loadCorpusManifest())) {
  await assertExactlyOne(
    target.corpusPath,
    target.acceptablePaths,
    '(walked-baseline document absent — the walk did not admit it, or something deleted it)',
  );
}

console.log(
  JSON.stringify({ event: 'cocoindex_census_gate', counts, failures }),
);
process.exit(failures > 0 ? 1 : 0);
