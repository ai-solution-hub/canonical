import { createServiceClient } from './fixtures/supabase';
const E2E_CONTENT_PREFIXES = ['[E2E-', '[E2E Test]'] as const;

async function cleanupContentItemsByTitlePrefix(
  supabase: ReturnType<typeof createServiceClient>,
  prefix: string,
): Promise<void> {
  const { data: rows, error } = await supabase
    .from('content_items')
    .select('id')
    .like('title', `${prefix}%`);

  if (error) {
    throw new Error(
      `Failed to query E2E content items for prefix ${prefix}: ${error.message}`,
    );
  }

  const ids = (rows ?? []).map((row) => row.id);
  if (ids.length === 0) return;

  await supabase.from('content_history').delete().in('content_item_id', ids);
  await supabase.from('content_items').delete().in('id', ids);
}

/**
 * Tag-based fallback sweep — catches admin-dedup fixture rows that escaped
 * per-worker cleanup. Admin-dedup fixtures use realistic-looking titles
 * (per design §3.2), so the title-prefix sweep above does NOT catch them;
 * the metadata->>'e2e_dedup_fixture_run_id' tag is the canonical handle.
 *
 * No time-window guard here: globalTeardown runs after every worker has
 * finished, so any tagged rows still present are by definition orphaned.
 *
 * FK-safe order: clear superseded_by self-FK first (a merge action may have
 * been exercised), then chunks, history, items. Mirrors sweepOrphanFixtures
 * in admin-dedup-fixture-helpers.ts.
 */
async function cleanupContentItemsByDedupFixtureTag(
  supabase: ReturnType<typeof createServiceClient>,
): Promise<void> {
  const { data: rows, error } = await supabase
    .from('content_items')
    .select('id')
    .not('metadata->e2e_dedup_fixture_run_id', 'is', null);

  if (error) {
    throw new Error(
      `Failed to query admin-dedup fixture content_items: ${error.message}`,
    );
  }

  const ids = (rows ?? []).map((row) => row.id);
  if (ids.length === 0) return;

  // FK-safe order: clear superseded_by FK first, then chunks, history, items
  await supabase
    .from('content_items')
    .update({ superseded_by: null })
    .in('id', ids);
  await supabase.from('content_chunks').delete().in('source_document_id', ids);
  await supabase.from('content_history').delete().in('content_item_id', ids);
  await supabase.from('content_items').delete().in('id', ids);
}

/**
 * Global teardown runs once after all test files have completed.
 *
 * This is a safety sweep only — per-worker cleanup is handled by the
 * workerData fixture teardown. This catches any orphaned data from
 * crashed workers.
 */
async function globalTeardown(): Promise<void> {
  console.log('E2E teardown: running safety cleanup...');
  try {
    const supabase = createServiceClient();

    // Clean up any orphaned E2E data (from crashed workers)
    for (const prefix of E2E_CONTENT_PREFIXES) {
      await cleanupContentItemsByTitlePrefix(supabase, prefix);
    }
    await supabase.from('workspaces').delete().like('name', '[E2E-%');

    // Clean orphaned notifications with E2E prefix
    await supabase.from('notifications').delete().like('title', '[E2E-%');

    // Also clean legacy [E2E Test] prefix data
    await supabase.from('workspaces').delete().like('name', '[E2E Test]%');

    // Tag-based fallback for admin-dedup fixtures (titles are realistic, so
    // the title-prefix sweeps above do not catch these). Per design §5.4.
    await cleanupContentItemsByDedupFixtureTag(supabase);

    console.log('E2E teardown: safety cleanup complete.');
  } catch (error) {
    console.error('E2E teardown: safety cleanup failed:', error);
    // Don't throw — teardown failures should not mask test results
  }
}

export default globalTeardown;
