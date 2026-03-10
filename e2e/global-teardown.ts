import { createServiceClient } from './fixtures/supabase';

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
    await supabase.from('content_items').delete().like('title', '[E2E-%');
    await supabase.from('workspaces').delete().like('name', '[E2E-%');

    // Clean orphaned notifications with E2E prefix
    await supabase.from('notifications').delete().like('title', '[E2E-%');

    // Also clean legacy [E2E Test] prefix data
    await supabase.from('content_items').delete().like('title', '[E2E Test]%');
    await supabase.from('workspaces').delete().like('name', '[E2E Test]%');

    console.log('E2E teardown: safety cleanup complete.');
  } catch (error) {
    console.error('E2E teardown: safety cleanup failed:', error);
    // Don't throw — teardown failures should not mask test results
  }
}

export default globalTeardown;
