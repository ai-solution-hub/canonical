#!/usr/bin/env bun
/**
 * Cleanup orphaned content_history rows in staging.
 *
 * Integration/E2E/MCP eval jobs can create content_items that fire
 * trg_content_items_ensure_v1_history. If a test later deletes the
 * content_item without deleting its content_history rows first, the FK's
 * ON DELETE SET NULL leaves orphaned rows that accumulate in staging.
 *
 * This script is intentionally staging-only by default:
 *   - Requires ALLOW_ORPHAN_CONTENT_HISTORY_CLEANUP=1
 *   - Refuses to run against the production project ref
 *   - Requires a service-role key
 */

import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { platformProjectRef } from '@/scripts/lib/project-refs';

const allowCleanup = process.env.ALLOW_ORPHAN_CONTENT_HISTORY_CLEANUP === '1';
const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!allowCleanup) {
  console.error(
    'Refusing cleanup: set ALLOW_ORPHAN_CONTENT_HISTORY_CLEANUP=1 to confirm staging-only cleanup intent.',
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

const supabase = createScriptClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { count, error } = await supabase
  .from('content_history')
  .delete({ count: 'exact' })
  .is('content_item_id', null);

if (error) {
  console.error(`content_history orphan cleanup failed: ${error.message}`);
  process.exit(1);
}

console.log(
  `content_history orphan cleanup complete (${count ?? 0} row(s) deleted).`,
);
