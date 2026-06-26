#!/usr/bin/env bun
/**
 * Cleanup stale staging test artifacts.
 *
 * This is intentionally staging-only by default:
 * - Requires ALLOW_STALE_TEST_ARTIFACT_CLEANUP=1.
 * - Refuses to run against the production project ref.
 * - Deletes only known test-prefixed content rows older than a configurable
 *   age threshold, so concurrent CI jobs do not lose fresh fixtures.
 *
 * The main target is leaked integration/MCP/E2E content_items that remain
 * visible to dashboard/reorient queries and can create noisy test data. Related
 * child rows are deleted before parent content_items so content_history does not
 * become an ON DELETE SET NULL orphan.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { createLooseScriptClient } from '@/scripts/lib/supabase-script-client';
import { platformProjectRef } from '@/scripts/lib/project-refs';
import { MCP_EVAL_SEED_METADATA_FLAG } from './mcp-eval/seed-data';

for (const envFile of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), envFile);
  if (existsSync(path)) {
    loadDotenv({ path, override: false });
  }
}

const DEFAULT_MIN_AGE_MINUTES = 120;
const CONTENT_TITLE_PREFIXES = [
  '[E2E-',
  '[E2E Test]',
  '[MCP-EVAL]',
  '[PUB-PATCH-',
  '[PUB-BULK-',
] as const;
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
function isPersistentMcpEvalSeed(metadata: unknown): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as Record<string, unknown>)[MCP_EVAL_SEED_METADATA_FLAG] === true
  );
}

async function selectContentItemIdsByPrefix(
  prefixes: readonly string[],
): Promise<string[]> {
  const ids = new Set<string>();
  for (const prefix of prefixes) {
    const { data, error } = await supabase
      .from('content_items')
      .select('id, metadata')
      .like('title', `${prefix}%`)
      .lt('created_at', cutoffIso)
      .limit(1000);

    if (error) {
      throw new Error(
        `Failed to query stale content_items for prefix ${prefix}: ${error.message}`,
      );
    }

    for (const row of data ?? []) {
      if (
        typeof row.id === 'string' &&
        !isPersistentMcpEvalSeed(row.metadata)
      ) {
        ids.add(row.id);
      }
    }
  }
  return Array.from(ids);
}

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

// Bound the PostgREST `in.(…)` request-URI length. A `.in(col, ids)` serialises
// every id into the URL; the prefix sweep above can return up to ~5000 UUIDs
// (5 prefixes × limit 1000), which blows past the Supabase gateway's ~8 KB URI
// cap → a bare-text "400 Bad Request" (non-JSON, so PostgREST surfaces it as the
// literal message "Bad Request"). That silently no-ops the ENTIRE cleanup loop
// (each delete logs a warning, returns 0) and is why stale rows accumulate.
const DELETE_BATCH_SIZE = 100; // ~100 UUIDs ≈ 4 KB URI, safely under the cap

async function deleteByIds(
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  let deleted = 0;
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

const contentItemIds = await selectContentItemIdsByPrefix(
  CONTENT_TITLE_PREFIXES,
);
const workspaceIds = await selectIdsByPrefix(
  'workspaces',
  'name',
  WORKSPACE_NAME_PREFIXES,
);

let relatedRowsDeleted = 0;
for (const [table, column] of [
  ['citations', 'cited_content_item_id'],
  ['content_chunks', 'content_item_id'],
  ['content_history', 'content_item_id'],
  ['content_item_workspaces', 'content_item_id'],
  ['entity_mentions', 'content_item_id'],
  ['entity_relationships', 'source_item_id'],
  ['classification_disputes', 'content_item_id'],
  ['ingestion_quality_log', 'content_item_id'],
  ['read_marks', 'content_item_id'],
  ['verification_history', 'content_item_id'],
] as const) {
  relatedRowsDeleted += await deleteByIds(table, column, contentItemIds);
}
relatedRowsDeleted += await deleteByIds(
  'notifications',
  'entity_id',
  contentItemIds,
);

const contentRowsDeleted = await deleteByIds(
  'content_items',
  'id',
  contentItemIds,
);
const workspaceRowsDeleted = await deleteByIds(
  'workspaces',
  'id',
  workspaceIds,
);

const { count: orphanHistoryRowsDeleted, error: orphanError } = await supabase
  .from('content_history')
  .delete({ count: 'exact' })
  .is('content_item_id', null);

if (orphanError) {
  console.warn(
    `Warning: failed to delete orphaned content_history rows: ${orphanError.message}`,
  );
}

console.log(
  `stale test artifact cleanup complete: ${contentRowsDeleted} content item(s), ` +
    `${workspaceRowsDeleted} workspace(s), ${relatedRowsDeleted} related row(s), ` +
    `${orphanHistoryRowsDeleted ?? 0} orphan history row(s) deleted; cutoff=${cutoffIso}`,
);
