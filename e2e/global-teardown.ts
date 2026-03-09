import { cleanupTestData } from './fixtures/test-data';

/**
 * Global teardown runs once after all test files have completed.
 *
 * Responsibilities:
 * 1. Remove all E2E test data from the database
 */
async function globalTeardown(): Promise<void> {
  console.log('E2E teardown: cleaning up test data...');
  try {
    await cleanupTestData();
    console.log('E2E teardown: cleanup complete.');
  } catch (error) {
    console.error('E2E teardown: failed to clean up test data:', error);
    // Don't throw — teardown failures should not mask test results
  }
}

export default globalTeardown;
