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
 * The manifest of record is verify_driver.py FIXTURE_SETS `templates`
 * (the `staging_mode: verify-driver` set): each dest path must resolve to
 * EXACTLY ONE source_documents row post-run. Fewer ⇒ staging/walk loss;
 * more ⇒ identity split (the F4 class). Exit 1 fails the gate.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import {
  loadCorpusManifest,
  verifyDriverDestPaths,
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
 * `__tests__/validation/corpus-manifest.test.ts` read the SAME file, so the two
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
for (const destPath of DRIVER_MANIFEST_DEST_PATHS) {
  const { data, error } = await client
    .from('source_documents')
    .select('id')
    .or(`storage_path.eq.${destPath},logical_path.eq.${destPath}`);
  if (error) {
    console.error(
      `census gate: query failed for ${destPath}: ${error.message}`,
    );
    process.exit(2);
  }
  const n = (data ?? []).length;
  counts[destPath] = n;
  if (n !== 1) {
    failures += 1;
    console.error(
      `census gate FAIL: ${destPath} resolves to ${n} source_documents ` +
        'row(s), expected exactly 1 ' +
        (n === 0
          ? '(staging/walk loss)'
          : '(identity split — the F4 UniqueViolation class)'),
    );
  }
}

console.log(
  JSON.stringify({ event: 'cocoindex_census_gate', counts, failures }),
);
process.exit(failures > 0 ? 1 : 0);
