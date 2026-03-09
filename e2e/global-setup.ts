import { seedTestData } from './fixtures/test-data';

/**
 * Global setup runs once before all test files.
 *
 * Responsibilities:
 * 1. Verify required environment variables are present
 * 2. Seed test data into the database
 */
async function globalSetup(): Promise<void> {
  // --- Verify required env vars ---
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `E2E setup: missing required environment variables: ${missing.join(', ')}. ` +
        'Ensure .env.local is loaded or these are set in the environment.'
    );
  }

  // Warn about optional test user credentials
  const hasTestCreds =
    process.env.E2E_TEST_EMAIL || process.env.TEST_USER_1_EMAIL;
  if (!hasTestCreds) {
    console.warn(
      'E2E setup: no test user credentials found (E2E_TEST_EMAIL or TEST_USER_1_EMAIL). ' +
        'Auth fixtures will use hardcoded defaults which may not work.'
    );
  }

  // --- Seed test data ---
  console.log('E2E setup: seeding test data...');
  try {
    const seeded = await seedTestData();
    console.log(
      `E2E setup: seeded ${seeded.contentItemIds.length} content items, ` +
        `${seeded.workspaceId ? '1 workspace' : '0 workspaces'}, ` +
        `${seeded.bidId ? '1 bid' : '0 bids'} with ${seeded.questionIds.length} questions.`
    );
  } catch (error) {
    console.error('E2E setup: failed to seed test data:', error);
    throw error;
  }
}

export default globalSetup;
