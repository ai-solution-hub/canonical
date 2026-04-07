/**
 * Global setup runs once before all test files.
 *
 * Responsibilities:
 * 1. Verify required environment variables are present.
 * 2. Verify test users exist with correct roles (Phase 4).
 *
 * Test data seeding is handled by the worker-scoped workerData fixture
 * in e2e/fixtures/test-data-fixture.ts.
 */
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from './fixtures/supabase';
import { TEST_USERS } from './fixtures/test-data';

async function globalSetup(): Promise<void> {
  // --- Step 1: Environment variables ---
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SECRET_KEY',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `E2E setup: missing required environment variables: ${missing.join(', ')}. ` +
        'Ensure .env.local is loaded or these are set in the environment.',
    );
  }

  // Warn about optional test user credentials
  const hasTestCreds =
    process.env.E2E_TEST_EMAIL || process.env.TEST_USER_1_EMAIL;
  if (!hasTestCreds) {
    console.warn(
      'E2E setup: no test user credentials found (E2E_TEST_EMAIL or TEST_USER_1_EMAIL). ' +
        'Auth fixtures will use hardcoded defaults which may not work.',
    );
  }

  console.log('E2E setup: environment validated.');

  // --- Step 2: Verify test users exist with correct roles ---
  const supabase = createServiceClient();

  // Query user_roles to get all roles, then cross-reference with auth.users
  // via the admin API to verify emails match expected roles.
  const { data: allRoles, error: rolesError } = await supabase
    .from('user_roles')
    .select('user_id, role');

  if (rolesError) {
    throw new Error(
      `E2E setup: failed to query user_roles: ${rolesError.message}. ` +
        'Ensure the SUPABASE_SECRET_KEY has service_role permissions.',
    );
  }

  if (!allRoles || allRoles.length === 0) {
    throw new Error(
      'E2E setup: user_roles table is empty. ' +
        'Test users must be created before running E2E tests. ' +
        'See docs/reference/e2e-test-setup.md for setup instructions.',
    );
  }

  // Resolve test users via signInWithPassword (anon key) instead of
  // `auth.admin.listUsers()`. The new `sb_secret_*` API key format does
  // not support the admin listUsers endpoint (returns "Database error
  // finding users"), but sign-in works fine. Each successful sign-in
  // returns the user's id, which we cross-reference against `user_roles`.
  const anonUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const anonClient = createClient(anonUrl, anonKey);

  const passwordEnvByLabel: Record<string, string> = {
    admin: 'TEST_USER_1_PASSWORD',
    editor: 'TEST_USER_2_PASSWORD',
    viewer: 'TEST_USER_3_PASSWORD',
  };

  const missingUsers: string[] = [];
  const wrongRoles: string[] = [];

  for (const [label, testUser] of Object.entries(TEST_USERS)) {
    const passwordEnv = passwordEnvByLabel[label];
    const password = passwordEnv ? process.env[passwordEnv] : undefined;
    if (!password) {
      missingUsers.push(`${label} (${testUser.email}) — missing password env`);
      continue;
    }
    const { data: signInData, error: signInError } =
      await anonClient.auth.signInWithPassword({
        email: testUser.email,
        password,
      });
    if (signInError || !signInData.user) {
      missingUsers.push(
        `${label} (${testUser.email}) — sign-in failed: ${signInError?.message ?? 'no user'}`,
      );
      continue;
    }
    const authUser = signInData.user;

    const userRole = allRoles.find((r) => r.user_id === authUser.id);

    if (!userRole) {
      wrongRoles.push(
        `${label} (${testUser.email}): no role assigned — expected '${testUser.expectedRole}'`,
      );
    } else if (userRole.role !== testUser.expectedRole) {
      wrongRoles.push(
        `${label} (${testUser.email}): role is '${userRole.role}' — expected '${testUser.expectedRole}'`,
      );
    }
  }

  if (missingUsers.length > 0) {
    throw new Error(
      `E2E setup: test users not found in auth.users:\n` +
        missingUsers.map((u) => `  - ${u}`).join('\n') +
        '\n\nCreate these users before running E2E tests. ' +
        'See docs/reference/e2e-test-setup.md for setup instructions.',
    );
  }

  if (wrongRoles.length > 0) {
    throw new Error(
      `E2E setup: test users have incorrect roles:\n` +
        wrongRoles.map((r) => `  - ${r}`).join('\n') +
        '\n\nFix roles in the user_roles table before running E2E tests.',
    );
  }

  console.log(
    `E2E setup: verified ${Object.keys(TEST_USERS).length} test users with correct roles.`,
  );
}

export default globalSetup;
