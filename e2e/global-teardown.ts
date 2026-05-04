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

    console.log('E2E teardown: safety cleanup complete.');
  } catch (error) {
    console.error('E2E teardown: safety cleanup failed:', error);
    // Don't throw — teardown failures should not mask test results
  }
}

export default globalTeardown;
