#!/usr/bin/env bun
/**
 * id-400 — cocoindex-nightly PRE-RUN SWEEP (D1 + NM-6).
 *
 * HARNESS.md §1 step 1 (id-397, RATIFIED) / id-396 TECH D1: before the
 * nightly stages anything, delete the FIXTURE-PREFIXED rows accumulated by
 * prior runs so the lane starts from a known fixture population (census
 * run-over-run deltas become signal — HARNESS §4). Scope is the ratified
 * owner amendment (S511 D1): fixture-prefixed TEST rows ONLY — Platform
 * staging's showcase/promote corpus is NEVER sweep-eligible.
 *
 * NM-6 (asserted, not just performed): the sweep FAILS THE RUN (exit 1)
 * if its scope guard would touch a non-fixture row — every candidate row
 * re-verified in-process against the declared prefix manifest before any
 * delete fires; one mismatch aborts with zero deletes.
 *
 * The declared manifest (single source for the sweep):
 *   - driver set  — storage_path under `verify/` (verify_driver.py
 *     FIXTURE_SETS `templates`, titlePrefixes VERIFY-*);
 *   - per-test    — filename carrying a declared bracketed TEST_PREFIX
 *     family (each test embeds its prefix in the dest FILENAME — OQ-62-6);
 *   - dest dirs   — storage_path under the declared per-test dest-prefix
 *     families (`inv-…`, `chunking-…`, `nm1-…`, `nm2-…`, `nm3-…` dirs).
 *
 * Deletion order: children first (q_a_extractions / entity_mentions /
 * entity_relationships / content_chunks / record_embeddings for both
 * owner kinds), then source_documents — robust regardless of per-FK ON
 * DELETE actions. pipeline_runs is NEVER touched: telemetry accumulates by
 * design (HARNESS §4 — comparability requires history).
 *
 * Guards (the cleanup-stale-test-artifacts idiom):
 *   - ALLOW_COCOINDEX_NIGHTLY_SWEEP=1 required;
 *   - FAIL-CLOSED target allowlist (PR #156 review): KH_SWEEP_EXPECTED_PROJECT_REF
 *     is REQUIRED and SUPABASE_URL must contain it — an unset expectation is
 *     a refusal, never a pass (the nightly passes the staging ref via
 *     secrets.PLATFORM_PROJECT_REF);
 *   - refuses the production project ref (defence-in-depth, subsumed by the
 *     allowlist).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import {
  loadCorpusManifest,
  walkedBaselinePathSet,
} from '@/lib/corpus/fixture-manifest';
import { SWEEP_STORAGE_PATH_PREFIX_FAMILIES } from '@/lib/corpus/sweep-scope';
import { createLooseScriptClient } from '@/scripts/lib/supabase-script-client';

for (const envFile of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), envFile);
  if (existsSync(path)) {
    loadDotenv({ path, override: false });
  }
}

// ── Declared fixture manifest ───────────────────────────────────────────────

/** Bracketed per-test TEST_PREFIX families (filename prefixes). */
const FILENAME_PREFIX_FAMILIES = [
  '[28.14-',
  '[28.18-',
  '[49.6-',
  '[53.14-',
  '[56.13-',
  '[56.9-',
  '[NM1-',
  '[NM2-',
  '[NM3-',
] as const;

/**
 * Declared dest-dir families (storage_path prefixes).
 *
 * Homed in `lib/corpus/sweep-scope.ts` so `__tests__/guards/corpus-manifest.test.ts`
 * can assert this list is disjoint from the walked baseline. This script cannot
 * be imported (top-level await + `process.exit` on refusal), so a copy here
 * would be a list no guard can see — which is how `verify/` came to select two
 * Platform-corpus rows and deadlock every run.
 */
const STORAGE_PATH_PREFIX_FAMILIES = SWEEP_STORAGE_PATH_PREFIX_FAMILIES;

const allowSweep = process.env.ALLOW_COCOINDEX_NIGHTLY_SWEEP === '1';
const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!allowSweep) {
  console.error(
    'Refusing sweep: set ALLOW_COCOINDEX_NIGHTLY_SWEEP=1 to confirm staging-only sweep intent.',
  );
  process.exit(2);
}
if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Refusing sweep: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.',
  );
  process.exit(2);
}
// Fail-closed target allowlist (PR #156 review): the sweep REQUIRES an
// explicit expected-target project ref and refuses unless SUPABASE_URL
// contains it. The former PROD_PROJECT_REF-only denylist failed OPEN when
// that env was unset; an unset expectation is now a refusal, never a pass.
const expectedRef = process.env.KH_SWEEP_EXPECTED_PROJECT_REF;
if (!expectedRef) {
  console.error(
    'Refusing sweep: KH_SWEEP_EXPECTED_PROJECT_REF is unset. Set it to the ' +
      'project ref this sweep is EXPECTED to target (the Platform staging ' +
      'ref — non-secret; the nightly passes secrets.PLATFORM_PROJECT_REF). ' +
      'The guard fails CLOSED without it.',
  );
  process.exit(2);
}
if (!supabaseUrl.includes(expectedRef)) {
  console.error(
    'Refusing sweep: SUPABASE_URL does not contain the expected project ref ' +
      `(KH_SWEEP_EXPECTED_PROJECT_REF=${expectedRef}) — the sweep is pointed ` +
      'at a project it was not told to target.',
  );
  process.exit(2);
}
// Defence-in-depth prod denylist (subsumed by the allowlist above; kept
// because it is trivial and catches a mis-set expectation).
const prodRef = process.env.PROD_PROJECT_REF;
if (prodRef && supabaseUrl.includes(prodRef)) {
  console.error(
    'Refusing sweep: SUPABASE_URL targets the PRODUCTION project ref.',
  );
  process.exit(2);
}

const client = createLooseScriptClient(supabaseUrl, serviceRoleKey);

interface CandidateRow {
  id: string;
  filename: string | null;
  storage_path: string | null;
  logical_path: string | null;
}

/**
 * A deletion predicate may read ONLY `storage_path` — the frozen seed-contract
 * admission key. Never `logical_path`, and never `filename`.
 *
 * Both of those are rewritten by identity resolution on a row this sweep must
 * never touch. `resolve_or_mint_source_identity` is content-hash-first: when an
 * integration test stages bytes that resolve onto a walked-baseline corpus row,
 * it updates that row's `logical_path` to the test's `inv-N/…` path
 * (`20260703160100_id138_admission_identity_fn.sql:58-64` — the rename-tolerance
 * clause). The corpus row then matched `STORAGE_PATH_PREFIX_FAMILIES` on its
 * logical_path and this sweep deleted a Platform-corpus document while its step
 * name still read "fixture-prefixed rows only". Resolution CONVERTS corpus rows
 * into fixture-prefixed rows; the old predicate could not tell the difference.
 *
 * Measured at S539 on Platform staging: two corpus documents sat in the old
 * predicate's scope — `content/synthetic-sector-spend.xlsx` (logical_path
 * `verify/…`) and `content/synthetic-named-client-engagements.md` (logical_path
 * `inv-20/…`, and a `[28.14-` filename). `synthetic-company-overview.md` had a
 * row at 2026-08-03 and again at 2026-08-07 and neither survives; the surviving
 * `entity_relationships` orphans (that FK is ON DELETE SET NULL where its
 * siblings CASCADE) are the tombstones.
 *
 * Nothing legitimate is lost by narrowing. A genuinely test-minted row mints
 * with `storage_path = <the test's rel_path>` and storage_path is frozen
 * thereafter, so every row this sweep exists to remove still matches. The only
 * rows it stops matching are the ones whose storage_path is a corpus path —
 * exactly the rows it must never have removed.
 */
function matchesDeclaredManifest(row: CandidateRow): boolean {
  const storagePath = row.storage_path ?? '';
  return STORAGE_PATH_PREFIX_FAMILIES.some((p) => storagePath.startsWith(p));
}

/**
 * Every path a walked-baseline document may legitimately be filed under, from
 * the manifest — its corpus path AND, where the verify driver also stages it,
 * its `verify_dest`.
 *
 * PREFIXES ARE NOT ENOUGH, and assuming they were shipped this guard broken.
 * `storage_path` is frozen at MINT, and whichever staging minted first won the
 * name — so a Platform-corpus document can be filed under `verify/…`.
 * Measured on staging: `synthetic-capability-statement.pdf` and
 * `synthetic-sector-intel.docx` both carry `storage_path = verify/…`. A guard
 * keyed on the corpus DIRECTORY prefixes (`content/`, `edge/`, `qa/`) cannot see
 * them, while `selectCandidates` — which includes `verify/` as a test family —
 * selects them for deletion. Exact membership is the only sound test.
 */
const WALKED_BASELINE_PATHS = walkedBaselinePathSet(loadCorpusManifest());

/**
 * NM-6, as ratified: *"the sweep step fails the run if its scope guard would
 * touch a non-fixture row"* (`specs/id-397-lane-target/HARNESS.md` §1.1),
 * enforcing D1's owner amendment *"showcase/platform content is never
 * sweep-eligible"* (`specs/id-396-corpus-model/TECH.md:107-111`, S511).
 *
 * This asserts the INVARIANT, not the selection predicate. Re-checking selection
 * against itself is a tautology that can never fail — which is what the guard
 * became the moment selection was narrowed to `storage_path`, and why narrowing
 * alone was not the fix. A guard that cannot fire is not a guard.
 *
 * It tests EITHER stored path against exact manifest membership. `logical_path`
 * is included deliberately even though selection ignores it: a corpus document
 * whose logical_path still names a baseline file is showcase content whatever
 * its storage_path says, and this guard's job is to refuse, not to select.
 */
function isShowcasePlatformContent(row: CandidateRow): boolean {
  return (
    WALKED_BASELINE_PATHS.has(row.storage_path ?? '') ||
    WALKED_BASELINE_PATHS.has(row.logical_path ?? '')
  );
}

/**
 * Selection keys on `storage_path` ONLY, for the reason given on
 * `matchesDeclaredManifest` — and selection is where it bites. That function is
 * the NM-6 abort-guard, not the delete filter: every row `selectCandidates`
 * returns is deleted, and the guard only aborts the run if one of them fails
 * the predicate. So narrowing the guard alone would not have saved a single
 * corpus row; it would merely have failed the sweep closed on every run. The
 * two must key on the same immutable field.
 *
 * The dropped legs were `filename LIKE 'VERIFY-%'`, `filename LIKE
 * '<bracketed-prefix>%'` and `logical_path LIKE '<family>%'`. Every row they can
 * legitimately reach is still reached: a genuinely test-minted row's
 * `storage_path` IS its test rel_path, frozen at mint.
 *
 * `FILENAME_PREFIX_FAMILIES` survives for REPORTING only — it attributes each
 * candidate to a test family in the run summary (`by_filename_family`). The
 * sweep is no longer entitled to DELETE on it. Do not re-wire it into selection.
 */
async function selectCandidates(): Promise<CandidateRow[]> {
  const byId = new Map<string, CandidateRow>();
  const queries: { column: string; pattern: string }[] = [
    ...STORAGE_PATH_PREFIX_FAMILIES.map((p) => ({
      column: 'storage_path',
      pattern: `${p}%`,
    })),
  ];
  for (const q of queries) {
    const { data, error } = await client
      .from('source_documents')
      .select('id, filename, storage_path, logical_path')
      .like(q.column, q.pattern);
    if (error) {
      console.error(
        `Sweep aborted: candidate query failed (${q.column} LIKE ${q.pattern}): ${error.message}`,
      );
      process.exit(1);
    }
    for (const row of (data ?? []) as CandidateRow[]) {
      byId.set(row.id, row);
    }
  }
  return [...byId.values()];
}

async function deleteWhereIn(
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  let deleted = 0;
  const CHUNK = 100;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { error, count } = await client
      .from(table)
      .delete({ count: 'exact' })
      .in(column, chunk);
    if (error) {
      console.error(
        `Sweep aborted: delete ${table}.${column} failed: ${error.message}`,
      );
      process.exit(1);
    }
    deleted += count ?? 0;
  }
  return deleted;
}

const candidates = await selectCandidates();

// ── NM-6 scope-guard assertion — BEFORE any delete ──────────────────────────
// Two independent checks, in D1's own priority order. The showcase check is
// FIRST because it is the ratified prohibition (S511); the declared-manifest
// check is the weaker "is this even a known family" backstop.
const showcaseViolations = candidates.filter(isShowcasePlatformContent);
if (showcaseViolations.length > 0) {
  console.error(
    `NM-6 SCOPE-GUARD VIOLATION: ${showcaseViolations.length} candidate row(s) ` +
      'are SHOWCASE/PLATFORM CONTENT — their frozen storage_path is inside the ' +
      `walked baseline (${[...WALKED_BASELINE_PATHS].join(', ')}). D1's owner ` +
      'amendment (S511, id-396/TECH.md:107-111) is that showcase/platform ' +
      'content is NEVER sweep-eligible. ABORTING WITH ZERO DELETES (this fails ' +
      'the run by design).\n' +
      'This is reachable without anyone changing the sweep: ' +
      'resolve_or_mint_source_identity is content-hash-first, so a test staging ' +
      "byte-identical content re-points a corpus row's logical_path/filename at " +
      'the test. storage_path is frozen at mint and is the only trustworthy key. ' +
      'Offending rows:',
  );
  for (const row of showcaseViolations.slice(0, 20)) {
    console.error(
      `  id=${row.id} storage_path=${JSON.stringify(row.storage_path)} ` +
        `logical_path=${JSON.stringify(row.logical_path)} ` +
        `filename=${JSON.stringify(row.filename)}`,
    );
  }
  process.exit(1);
}

const violations = candidates.filter((row) => !matchesDeclaredManifest(row));
if (violations.length > 0) {
  console.error(
    `NM-6 SCOPE-GUARD VIOLATION: ${violations.length} candidate row(s) do ` +
      'NOT match the declared fixture manifest — the sweep would touch ' +
      'non-fixture rows. ABORTING WITH ZERO DELETES (this fails the run by ' +
      'design). Offending rows:',
  );
  for (const row of violations.slice(0, 20)) {
    console.error(
      `  id=${row.id} filename=${JSON.stringify(row.filename)} ` +
        `storage_path=${JSON.stringify(row.storage_path)}`,
    );
  }
  process.exit(1);
}

if (candidates.length === 0) {
  console.log(
    JSON.stringify({
      event: 'cocoindex_nightly_sweep',
      candidates: 0,
      deleted: {},
    }),
  );
  process.exit(0);
}

const sdIds = candidates.map((row) => row.id);

/**
 * Attribute each candidate to the per-test family its filename declares, for the
 * summary below. This is the ONLY remaining use of `FILENAME_PREFIX_FAMILIES`:
 * reporting, never selection. `unattributed` is the interesting bucket — a row
 * inside a swept storage-path family whose filename belongs to no declared test
 * is either a new family nobody registered or a corpus row that resolution
 * entangled with a test, which is the S539 defect this predicate was narrowed to
 * prevent. Surfacing the count makes a recurrence visible in the run log rather
 * than only in a later forensic pass.
 */
const byFamily: Record<string, number> = {};
for (const row of candidates) {
  const filename = row.filename ?? '';
  const family =
    (filename.startsWith('VERIFY-') ? 'VERIFY-' : undefined) ??
    FILENAME_PREFIX_FAMILIES.find((p) => filename.startsWith(p)) ??
    'unattributed';
  byFamily[family] = (byFamily[family] ?? 0) + 1;
}

// Chunk ids first (their record_embeddings rows key on owner_id=chunk id).
const chunkIds: string[] = [];
{
  const CHUNK = 100;
  for (let i = 0; i < sdIds.length; i += CHUNK) {
    const { data, error } = await client
      .from('content_chunks')
      .select('id')
      .in('source_document_id', sdIds.slice(i, i + CHUNK));
    if (error) {
      console.error(`Sweep aborted: chunk id read failed: ${error.message}`);
      process.exit(1);
    }
    for (const row of (data ?? []) as { id: string }[]) chunkIds.push(row.id);
  }
}

const deleted: Record<string, number> = {};
deleted.record_embeddings_chunks =
  chunkIds.length > 0
    ? await deleteWhereIn('record_embeddings', 'owner_id', chunkIds)
    : 0;
deleted.record_embeddings_docs = await deleteWhereIn(
  'record_embeddings',
  'owner_id',
  sdIds,
);
deleted.q_a_extractions = await deleteWhereIn(
  'q_a_extractions',
  'source_document_id',
  sdIds,
);
deleted.entity_mentions = await deleteWhereIn(
  'entity_mentions',
  'source_document_id',
  sdIds,
);
deleted.entity_relationships = await deleteWhereIn(
  'entity_relationships',
  'source_document_id',
  sdIds,
);
deleted.content_chunks = await deleteWhereIn(
  'content_chunks',
  'source_document_id',
  sdIds,
);
deleted.source_documents = await deleteWhereIn('source_documents', 'id', sdIds);

console.log(
  JSON.stringify({
    event: 'cocoindex_nightly_sweep',
    candidates: candidates.length,
    by_filename_family: byFamily,
    deleted,
  }),
);
