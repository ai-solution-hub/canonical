#!/usr/bin/env bun
/**
 * Cleanup stale staging test artifacts.
 *
 * This is intentionally staging-only by default:
 * - Requires ALLOW_STALE_TEST_ARTIFACT_CLEANUP=1.
 * - Refuses to run against the production project ref.
 * - Deletes only known test-prefixed workspaces older than a configurable
 *   age threshold, so concurrent CI jobs do not lose fresh fixtures.
 *
 * ID-131.19 (M6, S450 GO tail): the former content_items-anchored cleanup
 * leg (content_items + its child rows — content_history,
 * content_item_workspaces, read_marks, citations.cited_content_item_id, and
 * the source_document_id-keyed related tables resolved via content_items)
 * is RETIRED — content_items and the three junction/history tables were
 * DROPPED at M6; there is nothing left to query. No production caller wired
 * this leg into CI (grepped clean), so the retirement is honest deletion,
 * not a silent behaviour change on a live path. The workspace cleanup below
 * is unaffected — workspaces is a separate table, not dropped.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { createLooseScriptClient } from '@/scripts/lib/supabase-script-client';
import { platformProjectRef } from '@/scripts/lib/project-refs';

for (const envFile of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), envFile);
  if (existsSync(path)) {
    loadDotenv({ path, override: false });
  }
}

const DEFAULT_MIN_AGE_MINUTES = 120;
const WORKSPACE_NAME_PREFIXES = ['[E2E-', '[E2E Test]'] as const;

const allowCleanup = process.env.ALLOW_STALE_TEST_ARTIFACT_CLEANUP === '1';
const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const minAgeMinutes = Number.parseInt(
  process.env.TEST_ARTIFACT_CLEANUP_MIN_AGE_MINUTES ??
    String(DEFAULT_MIN_AGE_MINUTES),
  10,
);

if (!allowCleanup) {
  console.error(
    'Refusing cleanup: set ALLOW_STALE_TEST_ARTIFACT_CLEANUP=1 to confirm staging-only cleanup intent.',
  );
  process.exit(2);
}

if (!Number.isFinite(minAgeMinutes) || minAgeMinutes < 0) {
  console.error(
    'Refusing cleanup: TEST_ARTIFACT_CLEANUP_MIN_AGE_MINUTES must be a non-negative integer.',
  );
  process.exit(2);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.',
  );
  process.exit(2);
}

// Runs against the Platform CI project by default. Refuse any other target
// unless the operator explicitly names a client staging DB via
// STAGING_PROJECT_REF (per-client refs are never committed — see
// scripts/lib/project-refs.ts).
const explicitStaging = process.env.STAGING_PROJECT_REF;
const onStagingTarget =
  !!explicitStaging && supabaseUrl.includes(explicitStaging);
if (!onStagingTarget && !supabaseUrl.includes(platformProjectRef())) {
  console.error(
    'Refusing cleanup: SUPABASE_URL is neither the Platform CI project nor a matching STAGING_PROJECT_REF target.',
  );
  process.exit(2);
}

const cutoffIso = new Date(Date.now() - minAgeMinutes * 60_000).toISOString();
// <any>: dynamic `.from(table)` over a runtime table list — intentionally loose
// (see supabase-script-client.ts).
const supabase = createLooseScriptClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function selectIdsByPrefix(
  table: 'workspaces',
  column: 'title' | 'name',
  prefixes: readonly string[],
): Promise<string[]> {
  const ids = new Set<string>();
  for (const prefix of prefixes) {
    const { data, error } = await supabase
      .from(table)
      .select('id')
      .like(column, `${prefix}%`)
      .lt('created_at', cutoffIso)
      .limit(1000);

    if (error) {
      throw new Error(
        `Failed to query stale ${table} for prefix ${prefix}: ${error.message}`,
      );
    }

    for (const row of data ?? []) {
      if (typeof row.id === 'string') ids.add(row.id);
    }
  }
  return Array.from(ids);
}

async function deleteByIds(
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  let deleted = 0;
  // Bound the PostgREST `in.(…)` request-URI length. A `.in(col, ids)`
  // serialises every id into the URL; batching keeps well under the
  // Supabase gateway's ~8 KB URI cap.
  const DELETE_BATCH_SIZE = 100; // ~100 UUIDs ≈ 4 KB URI, safely under the cap
  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    const batch = ids.slice(i, i + DELETE_BATCH_SIZE);
    const { count, error } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .in(column, batch);

    if (error) {
      console.warn(
        `Warning: failed to delete ${table}.${column} rows: ${error.message}`,
      );
      continue;
    }
    deleted += count ?? 0;
  }
  return deleted;
}

const workspaceIds = await selectIdsByPrefix(
  'workspaces',
  'name',
  WORKSPACE_NAME_PREFIXES,
);

const workspaceRowsDeleted = await deleteByIds(
  'workspaces',
  'id',
  workspaceIds,
);

console.log(
  `stale test artifact cleanup complete: ${workspaceRowsDeleted} workspace(s) deleted; cutoff=${cutoffIso}`,
);
