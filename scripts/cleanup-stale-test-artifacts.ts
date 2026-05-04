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

import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';

for (const envFile of ['.env.local', '.env']) {
  const path = resolve(process.cwd(), envFile);
  if (existsSync(path)) {
    loadDotenv({ path, override: false });
  }
}

const STAGING_PROJECT_REF = 'turayklvaunphgbgscat';
const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';
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

if (supabaseUrl.includes(PROD_PROJECT_REF)) {
  console.error('Refusing cleanup: SUPABASE_URL points at production.');
  process.exit(2);
}

if (!supabaseUrl.includes(STAGING_PROJECT_REF)) {
  console.warn(
    `Warning: SUPABASE_URL does not contain expected staging ref ${STAGING_PROJECT_REF}. ` +
      'Continuing because explicit cleanup flag is set; verify environment scoping if this is unexpected.',
  );
}

const cutoffIso = new Date(Date.now() - minAgeMinutes * 60_000).toISOString();
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function selectIdsByPrefix(
  table: 'content_items' | 'workspaces',
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
  const { count, error } = await supabase
    .from(table)
    .delete({ count: 'exact' })
    .in(column, ids);

  if (error) {
    console.warn(
      `Warning: failed to delete ${table}.${column} rows: ${error.message}`,
    );
    return 0;
  }
  return count ?? 0;
}

const contentItemIds = await selectIdsByPrefix(
  'content_items',
  'title',
  CONTENT_TITLE_PREFIXES,
);
const workspaceIds = await selectIdsByPrefix(
  'workspaces',
  'name',
  WORKSPACE_NAME_PREFIXES,
);

let relatedRowsDeleted = 0;
for (const [table, column] of [
  ['content_citations', 'content_item_id'],
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
