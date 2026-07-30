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

/** Declared dest-dir families (storage_path prefixes). */
const STORAGE_PATH_PREFIX_FAMILIES = [
  'verify/',
  'inv-',
  'chunking-',
  'nm1-ingest-once/',
  'nm2-keepwatch/',
  'nm3-legacy/',
] as const;

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

function matchesDeclaredManifest(row: CandidateRow): boolean {
  const filename = row.filename ?? '';
  if (
    filename.startsWith('VERIFY-') ||
    FILENAME_PREFIX_FAMILIES.some((p) => filename.startsWith(p))
  ) {
    return true;
  }
  for (const path of [row.storage_path ?? '', row.logical_path ?? '']) {
    if (STORAGE_PATH_PREFIX_FAMILIES.some((p) => path.startsWith(p))) {
      return true;
    }
  }
  return false;
}

async function selectCandidates(): Promise<CandidateRow[]> {
  const byId = new Map<string, CandidateRow>();
  const queries: { column: string; pattern: string }[] = [
    { column: 'filename', pattern: 'VERIFY-%' },
    ...FILENAME_PREFIX_FAMILIES.map((p) => ({
      column: 'filename',
      pattern: `${p}%`,
    })),
    ...STORAGE_PATH_PREFIX_FAMILIES.map((p) => ({
      column: 'storage_path',
      pattern: `${p}%`,
    })),
    ...STORAGE_PATH_PREFIX_FAMILIES.map((p) => ({
      column: 'logical_path',
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
    deleted,
  }),
);
